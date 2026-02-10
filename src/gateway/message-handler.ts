// src/gateway/message-handler.ts
/**
 * Message handler module.
 * Handles incoming messages: idempotency, rate limiting, commands, and agentic loop.
 */

import { createLogger } from "../utils/logger.js";
import type { MsgContext } from "../channels/interface.js";
import type { Config } from "../config/schema.js";
import type { WorkspaceFiles } from "../workspace/types.js";
import type { InfraStore } from "../infra/index.js";
import { hashMessage } from "../infra/index.js";
import { ChannelRegistry } from "../channels/registry.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { WriteGateChannel } from "../security/write-gate.js";
import type { SkillsInitResult } from "../skills/index.js";
import type { createSessionStore } from "../agent/session-store.js";
import type { createSessionTranscriptStore } from "../agent/session-transcript.js";
import type { Message } from "../agent/session.js";
import { resolveAgentId, resolveSessionKey } from "../agent/session-key.js";
import { shouldHandleMessage } from "./activation.js";
import { tryHandleCommand, tryHandleStatusCommand } from "./commands.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import { runAgenticLoop, createConversation } from "./agentic-loop.js";
import { resolveEffectiveProviders } from "../models/override.js";

const log = createLogger("gateway:message-handler");

/**
 * Dependencies for message handling.
 */
export interface MessageHandlerDeps {
  config: Config;
  workspace: WorkspaceFiles;
  sessionStore: ReturnType<typeof createSessionStore>;
  transcripts: ReturnType<typeof createSessionTranscriptStore>;
  channels: ChannelRegistry;
  tools: ToolRegistry;
  writeGateChannels: Map<string, WriteGateChannel>;
  skillsResult: SkillsInitResult | null;
  infraStore: InfraStore | null;
}

/**
 * Result of idempotency check.
 */
export interface IdempotencyCheckResult {
  /** Whether to skip processing (duplicate message) */
  skip: boolean;
  /** Idempotency key for later update */
  key?: string;
}

/**
 * Checks if a message was already processed (idempotency).
 * 
 * 检查消息是否已处理过，防止重复处理同一消息。
 * 
 * @param ctx - Message context
 * @param infraStore - Infrastructure store
 * @param infraConfig - Infrastructure configuration
 * @param now - Current timestamp
 * @returns Idempotency check result
 */
export function checkIdempotency(
  ctx: MsgContext,
  infraStore: InfraStore | null,
  infraConfig: Config["infra"],
  now: number,
): IdempotencyCheckResult {
  if (!infraStore || infraConfig?.idempotency?.enabled === false || !ctx.messageId) {
    return { skip: false };
  }

  const idempotencyKey = `msg:${ctx.channel}:${ctx.messageId}`;
  const messageHash = hashMessage(ctx.channel, ctx.messageId, ctx.body);
  const cached = infraStore.getIdempotency(idempotencyKey);

  if (cached && cached.requestHash === messageHash && cached.expiresAt > now) {
    log.debug(`Idempotency hit: skipping duplicate message ${ctx.messageId}`);
    return { skip: true, key: idempotencyKey };
  }

  // Save idempotency record (will be updated with response later)
  const ttlMs = infraConfig?.idempotency?.ttlMs ?? 5 * 60 * 1000;
  infraStore.saveIdempotency(idempotencyKey, messageHash, { processing: true }, now + ttlMs);

  return { skip: false, key: idempotencyKey };
}

/**
 * Result of rate limit check.
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Seconds until rate limit resets */
  waitSeconds?: number;
  /** Remaining requests in window */
  remaining?: number;
}

/**
 * Checks rate limiting for a user.
 * 
 * 检查用户请求频率，防止滥用。
 * 
 * @param ctx - Message context
 * @param infraStore - Infrastructure store
 * @param infraConfig - Infrastructure configuration
 * @param now - Current timestamp
 * @returns Rate limit check result
 */
export function checkRateLimit(
  ctx: MsgContext,
  infraStore: InfraStore | null,
  infraConfig: Config["infra"],
  now: number,
): RateLimitCheckResult {
  if (!infraStore || infraConfig?.rateLimit?.enabled === false) {
    return { allowed: true };
  }

  const bucket = `user:${ctx.channel}:${ctx.from}`;
  const windowMs = infraConfig?.rateLimit?.windowMs ?? 60_000;
  const maxMessages = infraConfig?.rateLimit?.maxMessages ?? 30;

  const { allowed, resetAt, remaining } = infraStore.checkRateLimit(
    bucket,
    windowMs,
    maxMessages,
    now,
  );

  if (!allowed) {
    const waitSeconds = Math.ceil((resetAt - now) / 1000);
    log.warn(`Rate limit exceeded for ${ctx.from} on ${ctx.channel}`);

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

    return { allowed: false, waitSeconds, remaining: 0 };
  }

  log.debug(`Rate limit check passed: ${remaining} remaining for ${ctx.from}`);
  return { allowed: true, remaining };
}

/**
 * Sends a rate limit warning to the user.
 * 
 * @param ctx - Message context
 * @param channels - Channel registry
 * @param waitSeconds - Seconds to wait
 */
export async function sendRateLimitWarning(
  ctx: MsgContext,
  channels: ChannelRegistry,
  waitSeconds: number,
): Promise<void> {
  const channel = channels.get(ctx.channel);
  if (channel) {
    const target = ctx.chatType === "direct" ? ctx.from : (ctx.groupId ?? ctx.from);
    await channel.send(target, {
      text: `⚠️ 消息过于频繁，请在 ${waitSeconds} 秒后再试。`,
      replyToId: ctx.messageId,
    });
  }
}

/**
 * Logs a message processing event to the infrastructure store.
 * 
 * @param infraStore - Infrastructure store
 * @param infraConfig - Infrastructure configuration
 * @param ctx - Message context
 * @param sessionKey - Session key
 * @param iterations - Number of agentic loop iterations
 * @param responseLength - Length of response content
 * @param startTime - Processing start time
 * @param isError - Whether the response indicates an error
 */
export function logMessageEvent(
  infraStore: InfraStore | null,
  infraConfig: Config["infra"],
  ctx: MsgContext,
  sessionKey: string,
  iterations: number,
  responseLength: number,
  startTime: number,
  isError: boolean,
): void {
  if (!infraStore || infraConfig?.eventStore?.enabled === false) {
    return;
  }

  const endTime = Date.now();
  const eventTtlMs = infraConfig?.eventStore?.ttlMs ?? 24 * 60 * 60 * 1000;

  infraStore.insertEvent({
    type: "message.processed",
    time: endTime,
    status: isError ? "error" : "success",
    source: `${ctx.channel}:${ctx.from}`,
    message: `Processed message in ${endTime - startTime}ms`,
    metadataJson: JSON.stringify({
      sessionKey,
      messageId: ctx.messageId,
      iterations,
      responseLength,
      durationMs: endTime - startTime,
    }),
    expiresAt: endTime + eventTtlMs,
  });
}

/**
 * Main message handler.
 * Processes incoming messages through the full pipeline:
 * 1. Activation check
 * 2. Idempotency check
 * 3. Rate limiting
 * 4. Command handling (/status, /new, etc.)
 * 5. Session management
 * 6. Agentic loop (LLM + tools)
 * 7. Event logging
 * 
 * @param ctx - Message context
 * @param deps - Handler dependencies
 */
export async function handleMessage(
  ctx: MsgContext,
  deps: MessageHandlerDeps,
): Promise<void> {
  const {
    config,
    workspace,
    sessionStore,
    transcripts,
    channels,
    tools,
    writeGateChannels,
    skillsResult,
    infraStore,
  } = deps;

  // Check if message should be handled (activation rules)
  if (!shouldHandleMessage(ctx, config)) {
    return;
  }

  const agentId = resolveAgentId({ config });
  const sessionKey = resolveSessionKey({ ctx, config });
  const now = Date.now();
  const infraConfig = config.infra;

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure: Idempotency Check
  // ─────────────────────────────────────────────────────────────────────────
  const idempotencyResult = checkIdempotency(ctx, infraStore, infraConfig, now);
  if (idempotencyResult.skip) {
    return;
  }

  let typingOn = false;
  try {
    // Only show typing once we've decided we'll process this message (and it's not a duplicate).
    if (ctx.setTyping) {
      ctx.setTyping(true);
      typingOn = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Infrastructure: Rate Limiting
    // ─────────────────────────────────────────────────────────────────────────
    const rateLimitResult = checkRateLimit(ctx, infraStore, infraConfig, now);
    if (!rateLimitResult.allowed) {
      await sendRateLimitWarning(ctx, channels, rateLimitResult.waitSeconds!);
      return;
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

    // ─────────────────────────────────────────────────────────────────────────
    // Handle slash commands (/new, /history, etc.)
    // ─────────────────────────────────────────────────────────────────────────
    const cmd = await tryHandleCommand({
      ctx,
      sessionKey,
      sessionStore,
      transcripts,
      channels,
      providers: config.providers,
      resetTriggers: config.session?.resetTriggers,
      defaultModelLabel: config.providers?.[0]
        ? `${config.providers[0].id}/${config.providers[0].model}`
        : undefined,
      workspacePath: config.workspace,
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

    // ─────────────────────────────────────────────────────────────────────────
    // Session Management
    // ─────────────────────────────────────────────────────────────────────────
    const entry = await sessionStore.getOrCreate(sessionKey, {
      channel: ctx.channel,
      chatType: ctx.chatType,
      groupId: ctx.groupId,
      displayName: ctx.senderName,
    });

    const resolved = resolveEffectiveProviders(config.providers, entry.primaryModelRefOverride);
    if (resolved.error) {
      log.warn(`Ignoring invalid primaryModelRefOverride: ${entry.primaryModelRefOverride}`, resolved.error);
    }
    const effectiveProviders = resolved.providers;
    const activeModelLabel = resolved.modelLabel;

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
      model: activeModelLabel,
      skills: skillsResult ?? undefined,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Agentic Loop
    // ─────────────────────────────────────────────────────────────────────────
    const conversationMessages = createConversation(systemPrompt, history);
    
    const loopResult = await runAgenticLoop(
      conversationMessages,
      {
        sessionKey,
        agentId,
        sessionId: entry.sessionId,
        userId: ctx.from,
        channelId: ctx.channel,
        chatTargetId: ctx.chatType === "direct" ? ctx.from : (ctx.groupId ?? ctx.from),
        workspacePath: config.workspace,
        memorySearchConfig: config.memorySearch,
        securityConfig: config.security,
      },
      {
        providers: effectiveProviders,
        tools,
        writeGateChannel: writeGateChannels.get(ctx.channel),
        transcripts,
      },
    );

    const finalContent = loopResult.content;

    log.info(`Final response: ${finalContent.slice(0, 50)}...`);

    // Append assistant response to session
    const assistantMessage: Message = {
      role: "assistant",
      content: finalContent,
      timestamp: Date.now(),
    };
    await transcripts.append(entry.sessionId, assistantMessage);

    // ─────────────────────────────────────────────────────────────────────────
    // Send Response
    // ─────────────────────────────────────────────────────────────────────────
    const channel = channels.get(ctx.channel);
    if (channel) {
      const target = ctx.chatType === "direct" ? ctx.from : (ctx.groupId ?? ctx.from);
      await channel.send(target, {
        text: finalContent,
        replyToId: ctx.messageId,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Log Event
    // ─────────────────────────────────────────────────────────────────────────
    logMessageEvent(
      infraStore,
      infraConfig,
      ctx,
      sessionKey,
      loopResult.iterations,
      finalContent.length,
      now,
      finalContent.startsWith("⚠️"),
    );
  } finally {
    if (typingOn) ctx.setTyping?.(false);
  }
}
