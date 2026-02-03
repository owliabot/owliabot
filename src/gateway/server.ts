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
import {
  createSessionManager,
  type Message,
  type SessionKey,
} from "../agent/session.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { MsgContext } from "../channels/interface.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { executeToolCalls } from "../agent/tools/executor.js";
import {
  echoTool,
  createHelpTool,
  createClearSessionTool,
  createMemorySearchTool,
  createMemoryGetTool,
  createListFilesTool,
} from "../agent/tools/builtin/index.js";
import type { ToolResult } from "../agent/tools/interface.js";
import { createCronService } from "../cron/service.js";
import { executeHeartbeat } from "../cron/heartbeat.js";
import { createNotificationService } from "../notifications/service.js";
import { initializeSkills } from "../skills/index.js";
import { join } from "node:path";

const log = createLogger("gateway");

export interface GatewayOptions {
  config: Config;
  workspace: WorkspaceFiles;
  sessionsDir: string;
}

export async function startGateway(
  options: GatewayOptions
): Promise<() => Promise<void>> {
  const { config, workspace, sessionsDir } = options;

  const channels = new ChannelRegistry();
  const sessions = createSessionManager(sessionsDir);

  // Create tool registry and register builtin tools
  const tools = new ToolRegistry();
  tools.register(echoTool);
  tools.register(createHelpTool(tools));
  tools.register(createClearSessionTool(sessions));
  tools.register(createMemorySearchTool(config.workspace));
  tools.register(createMemoryGetTool(config.workspace));
  tools.register(createListFilesTool(config.workspace));
  // NOTE: write tools are disabled for now (Phase 1.5) until we add confirmation/permission gates.

  // Load skills if enabled
  const skillsEnabled = config.skills?.enabled ?? true;
  if (skillsEnabled) {
    const skillsDir = config.skills?.directory ?? join(config.workspace, "skills");
    await initializeSkills(skillsDir, tools);
  }

  // Register Telegram if configured
  if (config.telegram && config.telegram.token) {
    const telegram = createTelegramPlugin({
      token: config.telegram.token,
      allowList: config.telegram.allowList,
    });

    telegram.onMessage(async (ctx) => {
      await handleMessage(ctx, config, workspace, sessions, channels, tools);
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
    });

    discord.onMessage(async (ctx) => {
      await handleMessage(ctx, config, workspace, sessions, channels, tools);
    });

    channels.register(discord);
  }

  if (config.telegram && !config.telegram.token) {
    log.warn("Telegram configured but token missing; skipping Telegram channel startup");
  }
  if (config.discord && !config.discord.token) {
    log.warn("Discord configured but token missing; skipping Discord channel startup");
  }

  // Start all channels
  await channels.startAll();
  log.info("Gateway started");

  // Create notification service
  const notifications = createNotificationService({
    defaultChannel: config.notifications?.channel,
    channels,
  });

  // Create cron service
  const cron = createCronService();

  // Schedule heartbeat if enabled
  if (config.heartbeat?.enabled) {
    cron.schedule({
      id: "heartbeat",
      pattern: config.heartbeat.cron,
      handler: async () => {
        await executeHeartbeat({ config, workspace, notifications });
      },
    });
    log.info(`Heartbeat scheduled: ${config.heartbeat.cron}`);
  }

  // Return cleanup function
  return async () => {
    cron.stopAll();
    await channels.stopAll();
    log.info("Gateway stopped");
  };
}

async function handleMessage(
  ctx: MsgContext,
  config: Config,
  workspace: WorkspaceFiles,
  sessions: ReturnType<typeof createSessionManager>,
  channels: ChannelRegistry,
  tools: ToolRegistry
): Promise<void> {
  const conversationId =
    ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
  const sessionKey: SessionKey = `${ctx.channel}:${conversationId}`;

  log.info(`Message from ${sessionKey}: ${ctx.body.slice(0, 50)}...`);

  // Append user message to session
  const userMessage: Message = {
    role: "user",
    content: ctx.body,
    timestamp: ctx.timestamp,
  };
  await sessions.append(sessionKey, userMessage);

  // Get conversation history
  const history = await sessions.getHistory(sessionKey);

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    workspace,
    channel: ctx.channel,
    timezone: "UTC+8", // TODO: from config
    model: config.providers[0].model,
  });

  // Agentic loop
  const MAX_ITERATIONS = 5;
  let iteration = 0;
  let finalContent = "";

  const conversationMessages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...history,
  ];

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
        agentId: "owliabot",
        signer: null,
        config: {},
      },
    });

    // Add assistant message with tool calls to conversation
    conversationMessages.push({
      role: "assistant",
      content: response.content || "",
      timestamp: Date.now(),
      toolCalls: response.toolCalls,
    });

    // Add tool results as user message with proper toolResults structure
    // The runner will convert this to pi-ai's ToolResultMessage format
    const toolResultsArray = response.toolCalls.map((call) => {
      const result = toolResults.get(call.id);
      return {
        ...result,
        toolCallId: call.id,
        toolName: call.name,
      } as ToolResult;
    });

    conversationMessages.push({
      role: "user",
      content: "", // Content is empty, tool results are in toolResults array
      timestamp: Date.now(),
      toolResults: toolResultsArray,
    });
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
  await sessions.append(sessionKey, assistantMessage);

  // Send response
  const channel = channels.get(ctx.channel);
  if (channel) {
    const target = ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
    await channel.send(target, {
      text: finalContent,
      replyToId: ctx.messageId,
    });
  }
}

