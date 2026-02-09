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
import { tryHandleCommand, tryHandleStatusCommand } from "./commands.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { executeToolCalls } from "../agent/tools/executor.js";
import {
  createBuiltinTools,
  createHelpTool,
  createExecTool,
  createWebFetchTool,
  createWebSearchTool,
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
import { createInfraStore, hashMessage, type InfraStore } from "../infra/index.js";
import { startGatewayHttp } from "./http/server.js";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

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

  // Initialize infrastructure store (rate limiting, idempotency, event logging)
  let infraStore: InfraStore | null = null;
  const infraConfig = config.infra;
  if (infraConfig?.enabled !== false) {
    const infraDbPath = infraConfig?.sqlitePath?.replace(
      /^~/,
      homedir(),
    ) ?? join(homedir(), ".owliabot", "infra.db");

    // Ensure parent directory exists
    const infraDbDir = dirname(infraDbPath);
    if (!existsSync(infraDbDir)) {
      mkdirSync(infraDbDir, { recursive: true });
    }

    infraStore = createInfraStore({ sqlitePath: infraDbPath });
    log.info(`Infrastructure store initialized: ${infraDbPath}`);
  }

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
    wallet: config.wallet,
  })) {
    tools.register(tool);
  }
  tools.register(createHelpTool(tools)); // Last - needs registry reference

  // System action tools (exec, web_fetch, web_search)
  // Conditionally registered based on config.system presence
  if (config.system?.exec) {
    tools.register(
      createExecTool({
        workspacePath: config.workspace,
        config: config.system.exec,
      })
    );
  }
  if (config.system?.web) {
    tools.register(
      createWebFetchTool({
        config: config.system.web,
      })
    );
  }
  // web_search requires explicit webSearch config (web config alone is not sufficient)
  if (config.system?.webSearch) {
    tools.register(
      createWebSearchTool({
        config: {
          web: config.system?.web,
          webSearch: config.system.webSearch,
        },
      })
    );
  }

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
        infraStore,
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
        infraStore,
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

  // Check if any provider has valid credentials
  const hasValidProvider = config.providers.some(
    (p) => p.apiKey && p.apiKey !== "oauth" && p.apiKey !== "env" && p.apiKey !== "secrets"
  );
  if (!hasValidProvider) {
    log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.warn("  ⚠ No valid provider credentials found.");
    log.warn("  Bot is running but cannot process messages.");
    log.warn("  Run: owliabot auth setup");
    log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }

  // Start all channels
  await channels.startAll();
  log.info("Gateway started");

  // Start Gateway HTTP if enabled
  // Phase 2 Unification: HTTP API as a Channel Adapter, requiring shared resources
  let stopHttp: (() => Promise<void>) | undefined;
  if (config.gateway?.http?.enabled) {
    const httpGateway = await startGatewayHttp({
      config: config.gateway.http,
      toolRegistry: tools,
      sessionStore,
      transcripts,
      workspacePath: config.workspace,
      system: config.system,
    });
    stopHttp = httpGateway.stop;

    // Register HTTP channel as a peer of Discord/Telegram
    channels.register(httpGateway.channel);
    writeGateChannels.set(
      "http",
      createWriteGateChannelAdapter(httpGateway.channel, replyRouter),
    );

    log.info(`Gateway HTTP server listening on ${httpGateway.baseUrl}`);
  }

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

  // Schedule periodic infra cleanup (every 5 minutes)
  let infraCleanupInterval: NodeJS.Timeout | null = null;
  if (infraStore) {
    infraCleanupInterval = setInterval(() => {
      infraStore?.cleanup(Date.now());
    }, 5 * 60 * 1000);
  }

  // Return cleanup function
  return async () => {
    if (infraCleanupInterval) {
      clearInterval(infraCleanupInterval);
    }
    if (infraStore) {
      infraStore.cleanup(Date.now());
      infraStore.close();
    }
    if (stopHttp) {
      await stopHttp();
    }
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
  infraStore: InfraStore | null,
): Promise<void> {
  if (!shouldHandleMessage(ctx, config)) {
    return;
  }

  const agentId = resolveAgentId({ config });
  const sessionKey = resolveSessionKey({ ctx, config });
  const now = Date.now();
  const infraConfig = config.infra;

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure: Idempotency Check (prevent duplicate message processing)
  // ─────────────────────────────────────────────────────────────────────────
  if (infraStore && infraConfig?.idempotency?.enabled !== false && ctx.messageId) {
    const idempotencyKey = `msg:${ctx.channel}:${ctx.messageId}`;
    const messageHash = hashMessage(ctx.channel, ctx.messageId, ctx.body);
    const cached = infraStore.getIdempotency(idempotencyKey);

    if (cached && cached.requestHash === messageHash && cached.expiresAt > now) {
      log.debug(`Idempotency hit: skipping duplicate message ${ctx.messageId}`);
      return; // Already processed this exact message
    }

    // Save idempotency record (will be updated with response later)
    const ttlMs = infraConfig?.idempotency?.ttlMs ?? 5 * 60 * 1000;
    infraStore.saveIdempotency(idempotencyKey, messageHash, { processing: true }, now + ttlMs);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure: Rate Limiting (prevent user spam)
  // ─────────────────────────────────────────────────────────────────────────
  if (infraStore && infraConfig?.rateLimit?.enabled !== false) {
    const bucket = `user:${ctx.channel}:${ctx.from}`;
    const windowMs = infraConfig?.rateLimit?.windowMs ?? 60_000;
    const maxMessages = infraConfig?.rateLimit?.maxMessages ?? 30;

    const { allowed, resetAt, remaining } = infraStore.checkRateLimit(bucket, windowMs, maxMessages, now);

    if (!allowed) {
      log.warn(`Rate limit exceeded for ${ctx.from} on ${ctx.channel}`);
      const waitSeconds = Math.ceil((resetAt - now) / 1000);

      // Log rate limit event
      if (infraConfig?.eventStore?.enabled !== false) {
        const eventTtlMs = infraConfig?.eventStore?.ttlMs ?? 24 * 60 * 60 * 1000;
        infraStore.insertEvent({
          type: "rate_limit",
          time: now,
          status: "blocked",
          source: `${ctx.channel}:${ctx.from}`,
          message: `Rate limit exceeded, wait ${waitSeconds}s`,
          metadataJson: JSON.stringify({ bucket, remaining: 0, resetAt }),
          expiresAt: now + eventTtlMs,
        });
      }

      // Send rate limit warning to user
      const channel = channels.get(ctx.channel);
      if (channel) {
        const target = ctx.chatType === "direct" ? ctx.from : (ctx.groupId ?? ctx.from);
        await channel.send(target, {
          text: `⚠️ 消息过于频繁，请在 ${waitSeconds} 秒后再试。`,
          replyToId: ctx.messageId,
        });
      }
      return;
    }

    log.debug(`Rate limit check passed: ${remaining} remaining for ${ctx.from}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handle /status command (infrastructure status)
  // ─────────────────────────────────────────────────────────────────────────
  const statusCmd = await tryHandleStatusCommand({
    ctx,
    channels,
    infraStore,
  });
  if (statusCmd.handled) return;

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
          apiKey: config.providers?.[0]?.apiKey,
        }
      : config.providers?.[0]
        ? {
            provider: config.providers[0].id,
            model: config.providers[0].model,
            apiKey: config.providers[0].apiKey,
          }
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

  // Check if any provider has valid credentials before entering the agentic loop
  const hasValidProvider = config.providers.some(
    (p) => p.apiKey && p.apiKey !== "oauth" && p.apiKey !== "env" && p.apiKey !== "secrets"
  );
  if (!hasValidProvider) {
    const noProviderMsg =
      "⚠️ AI provider not configured. Run `owliabot auth setup` to set up credentials.";
    const channel = channels.get(ctx.channel);
    if (channel) {
      const target =
        ctx.chatType === "direct" ? ctx.from : (ctx.groupId ?? ctx.from);
      await channel.send(target, {
        text: noProviderMsg,
        replyToId: ctx.messageId,
      });
    }
    return;
  }

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

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure: Event Store (log message processing result)
  // ─────────────────────────────────────────────────────────────────────────
  if (infraStore && infraConfig?.eventStore?.enabled !== false) {
    const eventTtlMs = infraConfig?.eventStore?.ttlMs ?? 24 * 60 * 60 * 1000;
    const endTime = Date.now();
    const isError = finalContent.startsWith("⚠️");

    infraStore.insertEvent({
      type: "message.processed",
      time: endTime,
      status: isError ? "error" : "success",
      source: `${ctx.channel}:${ctx.from}`,
      message: `Processed message in ${endTime - now}ms`,
      metadataJson: JSON.stringify({
        sessionKey,
        messageId: ctx.messageId,
        iterations: iteration,
        responseLength: finalContent.length,
        durationMs: endTime - now,
      }),
      expiresAt: endTime + eventTtlMs,
    });
  }
}
