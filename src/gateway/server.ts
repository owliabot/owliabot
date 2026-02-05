// src/gateway/server.ts
/**
 * Gateway / Main Loop
 * @see design.md Section 5.8
 */

import { createLogger } from "../utils/logger.js";
import type { Config } from "../config/schema.js";
import type { WorkspaceFiles } from "../workspace/types.js";
import { ChannelRegistry } from "../channels/registry.js";
import { createTelegramPlugin } from "../channels/telegram/index.js";
import { createDiscordPlugin } from "../channels/discord/index.js";
import type { Message } from "../agent/session.js";
import { resolveAgentId, resolveSessionKey } from "../agent/session-key.js";
import { createSessionStore, type SessionKey } from "../agent/session-store.js";
import { createSessionTranscriptStore } from "../agent/session-transcript.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { MsgContext } from "../channels/interface.js";
import { shouldHandleMessage } from "./activation.js";
import { tryHandleCommand } from "./commands.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { executeToolCalls } from "../agent/tools/executor.js";
import {
  createBuiltinTools,
  createHelpTool,
} from "../agent/tools/builtin/index.js";
import {
  WriteGateReplyRouter,
  createWriteGateChannelAdapter,
} from "../security/write-gate-adapter.js";
import type { WriteGateChannel } from "../security/write-gate.js";
import type { ToolResult } from "../agent/tools/interface.js";
import { createCronService } from "../cron/legacy-service.js";
import { executeHeartbeat } from "../cron/heartbeat.js";
import { createCronIntegration } from "./cron-integration.js";
import { createCronTool } from "../agent/tools/builtin/cron.js";
import { createNotificationService } from "../notifications/service.js";
import { initializeSkills, type SkillsInitResult } from "../skills/index.js";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

/**
 * Resolve bundled skills directory (like OpenClaw's approach)
 * Checks multiple candidate paths and returns the first that exists
 */
function resolveBundledSkillsDir(): string | undefined {
  const candidates: string[] = [];

  // 1. Environment variable override
  const override = process.env.OWLIABOT_BUNDLED_SKILLS_DIR?.trim();
  if (override) {
    candidates.push(override);
  }

  // 2. Resolve from module location: walk up to find package root with skills/
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // Try multiple levels up (handles src/, dist/, dist/gateway/, etc.)
    for (const levels of [
      "../..",
      "../../..",
      "../../../..",
      "../../../../..",
    ]) {
      candidates.push(resolve(moduleDir, levels, "skills"));
    }
  } catch (err) {
    // Log but continue with other candidates
    console.debug(`[skills] import.meta.url resolution failed: ${err}`);
  }

  // 3. Try relative to cwd (for dev mode and some install scenarios)
  candidates.push(resolve(process.cwd(), "skills"));

  // 4. Try common install locations
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (homeDir) {
    candidates.push(resolve(homeDir, ".owliabot", "bundled-skills"));
  }

  // Find first existing directory
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.debug(`[skills] Found bundled skills at: ${candidate}`);
      return candidate;
    }
  }

  console.debug(
    `[skills] No bundled skills directory found. Tried: ${candidates.join(", ")}`,
  );
  return undefined;
}

const log = createLogger("gateway");

export interface GatewayOptions {
  config: Config;
  workspace: WorkspaceFiles;
  sessionsDir: string;
}

export async function startGateway(
  options: GatewayOptions,
): Promise<() => Promise<void>> {
  const { config, workspace, sessionsDir } = options;

  const channels = new ChannelRegistry();

  const sessionStore = createSessionStore({
    sessionsDir,
    storePath: config.session?.storePath,
  });

  const transcripts = createSessionTranscriptStore({
    sessionsDir,
  });

  // Create tool registry and register builtin tools via factory
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools({
    workspace: config.workspace,
    sessionStore,
    transcripts,
    tools: config.tools,
  })) {
    tools.register(tool);
  }
  tools.register(createHelpTool(tools)); // Last - needs registry reference

  // Load skills if enabled
  // Multi-directory loading: builtin → user home → workspace (later overrides earlier)
  let skillsResult: SkillsInitResult | null = null;
  const skillsEnabled = config.skills?.enabled ?? true;
  if (skillsEnabled) {
    const builtinSkillsDir = resolveBundledSkillsDir();
    const userSkillsDir = join(homedir(), ".owliabot", "skills");
    const workspaceSkillsDir =
      config.skills?.directory ?? join(config.workspace, "skills");

    // Collect directories that exist, in priority order (later overrides earlier)
    const skillsDirs: string[] = [];
    if (builtinSkillsDir) {
      skillsDirs.push(builtinSkillsDir);
      log.debug(`Skills: using bundled dir: ${builtinSkillsDir}`);
    } else {
      log.warn("Skills: bundled skills directory not found");
    }
    if (existsSync(userSkillsDir)) {
      skillsDirs.push(userSkillsDir);
      log.debug(`Skills: using user dir: ${userSkillsDir}`);
    }
    if (existsSync(workspaceSkillsDir)) {
      skillsDirs.push(workspaceSkillsDir);
      log.debug(`Skills: using workspace dir: ${workspaceSkillsDir}`);
    }

    log.info(`Skills: loading from ${skillsDirs.length} directories`);
    skillsResult = await initializeSkills(skillsDirs);
  }

  // WriteGate reply router (shared across all channels)
  const replyRouter = new WriteGateReplyRouter();

  // Map channel id → WriteGateChannel adapter
  const writeGateChannels = new Map<string, WriteGateChannel>();

  // Register Telegram if configured
  if (config.telegram && config.telegram.token) {
    const telegram = createTelegramPlugin({
      token: config.telegram.token,
      allowList: config.telegram.allowList,
    });

    writeGateChannels.set(
      "telegram",
      createWriteGateChannelAdapter(telegram, replyRouter),
    );

    telegram.onMessage(async (ctx) => {
      if (replyRouter.tryRoute(ctx)) return; // confirmation reply consumed
      await handleMessage(
        ctx,
        config,
        workspace,
        sessionStore,
        transcripts,
        channels,
        tools,
        writeGateChannels,
        skillsResult,
      );
    });

    channels.register(telegram);
  }

  // Register Discord if configured
  if (config.discord && config.discord.token) {
    const discord = createDiscordPlugin({
      token: config.discord.token,
      memberAllowList: config.discord.memberAllowList,
      channelAllowList: config.discord.channelAllowList,
      requireMentionInGuild: config.discord.requireMentionInGuild,
      // Let WriteGate confirmation replies bypass the mention gate
      preFilter: (ctx) => replyRouter.hasPendingWaiter(ctx),
    });

    writeGateChannels.set(
      "discord",
      createWriteGateChannelAdapter(discord, replyRouter),
    );

    discord.onMessage(async (ctx) => {
      if (replyRouter.tryRoute(ctx)) return; // confirmation reply consumed
      await handleMessage(
        ctx,
        config,
        workspace,
        sessionStore,
        transcripts,
        channels,
        tools,
        writeGateChannels,
        skillsResult,
      );
    });

    channels.register(discord);
  }

  if (config.telegram && !config.telegram.token) {
    log.warn(
      "Telegram configured but token missing; skipping Telegram channel startup",
    );
  }
  if (config.discord && !config.discord.token) {
    log.warn(
      "Discord configured but token missing; skipping Discord channel startup",
    );
  }

  // Start all channels
  await channels.startAll();
  log.info("Gateway started");

  // Create notification service
  const notifications = createNotificationService({
    defaultChannel: config.notifications?.channel,
    channels,
  });

  // Create legacy cron service (for heartbeat scheduling)
  const legacyCron = createCronService();

  // Schedule heartbeat if enabled (using legacy cron for now)
  if (config.heartbeat?.enabled) {
    legacyCron.schedule({
      id: "heartbeat",
      pattern: config.heartbeat.cron,
      handler: async () => {
        await executeHeartbeat({ config, workspace, notifications });
      },
    });
    log.info(`Heartbeat scheduled: ${config.heartbeat.cron}`);
  }

  // Create new CronService (OpenClaw-compatible) with integration
  const cronIntegration = createCronIntegration({
    config,
    onSystemEvent: (text, opts) => {
      log.debug(
        { text: text.slice(0, 50), agentId: opts?.agentId },
        "system event enqueued",
      );
    },
    onHeartbeatRequest: (reason) => {
      log.debug({ reason }, "heartbeat requested");
    },
    // runHeartbeatOnce and runIsolatedAgentJob will be wired when session infra is ready
  });

  // Register cron tool
  tools.register(createCronTool({ cronService: cronIntegration.cronService }));

  // Start cron service
  await cronIntegration.start();
  log.info("Cron service started");

  // Return cleanup function
  return async () => {
    cronIntegration.stop();
    legacyCron.stopAll();
    await channels.stopAll();
    log.info("Gateway stopped");
  };
}

async function handleMessage(
  ctx: MsgContext,
  config: Config,
  workspace: WorkspaceFiles,
  sessionStore: ReturnType<typeof createSessionStore>,
  transcripts: ReturnType<typeof createSessionTranscriptStore>,
  channels: ChannelRegistry,
  tools: ToolRegistry,
  writeGateChannels: Map<string, WriteGateChannel>,
  skillsResult: SkillsInitResult | null,
): Promise<void> {
  if (!shouldHandleMessage(ctx, config)) {
    return;
  }

  const agentId = resolveAgentId({ config });
  const sessionKey = resolveSessionKey({ ctx, config });

  // Intercept slash commands before the LLM loop
  const cmd = await tryHandleCommand({
    ctx,
    sessionKey,
    sessionStore,
    transcripts,
    channels,
    resetTriggers: config.session?.resetTriggers,
    defaultModelLabel: config.providers?.[0]?.model,
    workspacePath: config.workspace,
    // Use configured summaryModel, or fall back to default provider's model (OpenClaw strategy)
    summaryModel: config.session?.summaryModel
      ? {
          provider: config.providers?.[0]?.id,
          model: config.session.summaryModel,
        }
      : config.providers?.[0]
        ? { provider: config.providers[0].id, model: config.providers[0].model }
        : undefined,
    summarizeOnReset: config.session?.summarizeOnReset,
    timezone: config.timezone,
  });
  if (cmd.handled) return;

  log.info(`Message from ${sessionKey}: ${ctx.body.slice(0, 50)}...`);

  const entry = await sessionStore.getOrCreate(sessionKey, {
    channel: ctx.channel,
    chatType: ctx.chatType,
    groupId: ctx.groupId,
    displayName: ctx.senderName,
  });

  // Append user message to transcript
  const userMessage: Message = {
    role: "user",
    content: ctx.body,
    timestamp: ctx.timestamp,
  };
  await transcripts.append(entry.sessionId, userMessage);

  // Get conversation history
  const history = await transcripts.getHistory(entry.sessionId);

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    workspace,
    channel: ctx.channel,
    chatType: ctx.chatType,
    timezone: config.timezone,
    model: config.providers[0].model,
    skills: skillsResult ?? undefined,
  });

  // Agentic loop
  const MAX_ITERATIONS = 5;
  let iteration = 0;
  let finalContent = "";

  const conversationMessages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...history,
  ];

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      log.debug(`Agentic loop iteration ${iteration}`);

      // Call LLM with tools
      const providers: LLMProvider[] = config.providers;
      const response = await callWithFailover(providers, conversationMessages, {
        tools: tools.getAll(),
      });

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalContent = response.content;
        break;
      }

      log.info(`LLM requested ${response.toolCalls.length} tool calls`);

      // Execute tool calls
      const toolResults = await executeToolCalls(response.toolCalls, {
        registry: tools,
        context: {
          sessionKey,
          agentId,
          signer: null,
          config: {
            memorySearch: config.memorySearch,
          },
        },
        writeGateChannel: writeGateChannels.get(ctx.channel),
        securityConfig: config.security,
        workspacePath: config.workspace,
        userId: ctx.from,
      });

      // Add assistant message with tool calls to conversation
      const assistantToolCallMessage: Message = {
        role: "assistant",
        content: response.content || "",
        timestamp: Date.now(),
        toolCalls: response.toolCalls,
      };
      conversationMessages.push(assistantToolCallMessage);
      await transcripts.append(entry.sessionId, assistantToolCallMessage);

      // Add tool results as user message with proper toolResults structure
      // The runner will convert this to pi-ai's ToolResultMessage format
      const toolResultsArray = response.toolCalls.map((call) => {
        const result = toolResults.get(call.id);
        if (!result) {
          return {
            success: false,
            error: "Missing tool result",
            toolCallId: call.id,
            toolName: call.name,
          } as ToolResult;
        }
        return {
          ...result,
          toolCallId: call.id,
          toolName: call.name,
        } as ToolResult;
      });

      const toolResultMessage: Message = {
        role: "user",
        content: "", // Content is empty, tool results are in toolResults array
        timestamp: Date.now(),
        toolResults: toolResultsArray,
      };
      conversationMessages.push(toolResultMessage);
      await transcripts.append(entry.sessionId, toolResultMessage);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Provide a user-visible hint for missing provider keys / auth.
    if (message.includes("No API key found for anthropic")) {
      finalContent =
        "⚠️ Anthropic 未授权：请先运行 `owliabot auth setup`（或设置 `ANTHROPIC_API_KEY`），然后再试一次。";
    } else {
      finalContent = `⚠️ 处理失败：${message}`;
    }
  }

  if (!finalContent && iteration >= MAX_ITERATIONS) {
    finalContent =
      "I apologize, but I couldn't complete your request. Please try again.";
  }

  log.info(`Final response: ${finalContent.slice(0, 50)}...`);

  // Append assistant response to session
  const assistantMessage: Message = {
    role: "assistant",
    content: finalContent,
    timestamp: Date.now(),
  };
  await transcripts.append(entry.sessionId, assistantMessage);

  // Send response
  const channel = channels.get(ctx.channel);
  if (channel) {
    const target =
      ctx.chatType === "direct" ? ctx.from : (ctx.groupId ?? ctx.from);
    await channel.send(target, {
      text: finalContent,
      replyToId: ctx.messageId,
    });
  }
}
