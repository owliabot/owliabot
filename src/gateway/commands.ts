// src/gateway/commands.ts
/**
 * Slash-command interceptor for the gateway message pipeline.
 *
 * Handles commands like /new, /reset before they reach the LLM agent loop.
 * Modeled after OpenClaw's resetTriggers behavior:
 * - Case-insensitive trigger matching
 * - Authorization check (only allowed senders can reset)
 * - Model override on reset (/new sonnet)
 * - Greeting with model info
 * - Optional memory summarization before clear
 */

import { createLogger } from "../utils/logger.js";
import type { MsgContext } from "../channels/interface.js";
import type { SessionStore } from "../agent/session-store.js";
import type { SessionTranscriptStore } from "../agent/session-transcript.js";
import type { ChannelRegistry } from "../channels/registry.js";
import { summarizeAndSave, type SummarizeResult } from "./session-summarizer.js";
import type { ModelConfig } from "../agent/models.js";

const log = createLogger("commands");

/** Default triggers that reset the session. */
const DEFAULT_RESET_TRIGGERS = ["/new", "/reset"];

/** Help command triggers */
const HELP_TRIGGERS = ["/help", "help"];

/** Help message text */
const HELP_TEXT = `🦉 **OwliaBot 帮助**

**命令**
• \`/new\` — 开始新会话
• \`/new <model>\` — 切换模型并开始新会话 (sonnet, opus, haiku, gpt-4o)
• \`/reset\` — 重置当前会话
• \`/help\` — 显示此帮助信息

**使用**
直接 @我 发送消息即可开始对话。

**模型别名**
• sonnet → claude-sonnet-4-5
• opus → claude-opus-4-5
• haiku → claude-haiku-4-5
• gpt-4o → OpenAI GPT-4o`;

/**
 * Known model aliases for /new model switching.
 * Maps alias → { provider, model } for quick resolution.
 */
const MODEL_ALIASES: Record<string, { provider: string; model: string }> = {
  sonnet: { provider: "anthropic", model: "claude-sonnet-4-5" },
  opus: { provider: "anthropic", model: "claude-opus-4-5" },
  haiku: { provider: "anthropic", model: "claude-haiku-4-5" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
  gemini: { provider: "google", model: "gemini-2.5-pro" },
  "gemini-flash": { provider: "google", model: "gemini-2.5-flash" },
};

export interface CommandContext {
  ctx: MsgContext;
  sessionKey: string;
  sessionStore: SessionStore;
  transcripts: SessionTranscriptStore;
  channels: ChannelRegistry;
  resetTriggers?: string[];
  /** Workspace root path — needed for writing memory summaries. */
  workspacePath?: string;
  /** Override the model used for summarization. */
  summaryModel?: ModelConfig;
  /** Timezone for date formatting in memory files. */
  timezone?: string;
  /**
   * Authorization check: if provided, only these sender IDs can trigger reset.
   * If undefined/empty, all senders are allowed (backward compat).
   */
  authorizedSenders?: string[];
  /** Default model label for greeting (e.g. "anthropic/claude-sonnet-4-5"). */
  defaultModelLabel?: string;
  /** Whether to summarize transcript to memory before reset. Default: true. */
  summarizeOnReset?: boolean;
}

export interface CommandResult {
  /** Whether the command was handled (true = skip LLM loop). */
  handled: boolean;
}

export interface ModelSelection {
  provider: string;
  model: string;
  alias?: string;
}

/**
 * Try to resolve a string as a model alias or provider/model pair.
 * Returns null if not recognized.
 */
export function resolveModelFromRemainder(token: string): ModelSelection | null {
  if (!token) return null;

  const lower = token.toLowerCase();

  // Check aliases first
  const alias = MODEL_ALIASES[lower];
  if (alias) {
    return { provider: alias.provider, model: alias.model, alias: lower };
  }

  // Check provider/model format (e.g. "anthropic/claude-sonnet-4-5")
  if (token.includes("/")) {
    const [provider, model] = token.split("/", 2);
    if (provider && model) {
      return { provider, model };
    }
  }

  return null;
}

/**
 * Try to intercept a slash command. Returns { handled: true } if the message
 * was a recognized command and has been fully processed (reply sent).
 *
 * If not a command, returns { handled: false } and the caller should continue
 * to the normal LLM agent loop.
 */
export async function tryHandleCommand(
  options: CommandContext
): Promise<CommandResult> {
  const {
    ctx, sessionKey, sessionStore, transcripts, channels,
    resetTriggers, workspacePath, summaryModel, timezone,
    authorizedSenders, defaultModelLabel,
    summarizeOnReset = true,
  } = options;

  const body = ctx.body.trim();
  const bodyLower = body.toLowerCase();

  // Check for help command first (no auth required)
  const isHelp = HELP_TRIGGERS.some((t) => bodyLower === t.toLowerCase());
  if (isHelp) {
    log.info(`Help command from ${ctx.from}`);
    const channel = channels.get(ctx.channel);
    if (channel) {
      const target = ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
      await channel.send(target, {
        text: HELP_TEXT,
        replyToId: ctx.messageId,
      });
    }
    return { handled: true };
  }

  const triggers = resetTriggers ?? DEFAULT_RESET_TRIGGERS;

  // Case-insensitive trigger matching (aligned with OpenClaw)
  const matchedTrigger = triggers.find((t) => {
    const tLower = t.toLowerCase();
    return bodyLower === tLower || bodyLower.startsWith(tLower + " ");
  });

  if (!matchedTrigger) {
    return { handled: false };
  }

  // Authorization check (aligned with OpenClaw)
  if (authorizedSenders && authorizedSenders.length > 0) {
    if (!authorizedSenders.includes(ctx.from)) {
      log.info(`Ignoring reset from unauthorized sender: ${ctx.from}`);
      return { handled: false };
    }
  }

  // Extract remainder after the trigger (e.g. "/new sonnet" → "sonnet")
  // Use original body (not lowered) to preserve casing for non-model remainder
  const remainder = body.slice(matchedTrigger.length).trim();

  log.info(`Reset command "${matchedTrigger}" from ${sessionKey}${remainder ? ` (remainder: "${remainder}")` : ""}`);

  // Try to parse remainder as model override
  let modelSelection: ModelSelection | null = null;
  let bodyAfterModel = remainder;

  if (remainder) {
    const tokens = remainder.split(/\s+/);
    const firstToken = tokens[0];

    // Try first token as model
    modelSelection = resolveModelFromRemainder(firstToken);
    if (modelSelection) {
      bodyAfterModel = tokens.slice(1).join(" ").trim();
    }
  }

  // Rotate session (creates a new sessionId for this sessionKey)
  const oldEntry = await sessionStore.get(sessionKey);

  // Summarize transcript → memory before clearing (non-blocking on failure)
  let summaryResult: SummarizeResult = { summarized: false };
  if (summarizeOnReset && oldEntry?.sessionId && workspacePath) {
    summaryResult = await summarizeAndSave({
      sessionId: oldEntry.sessionId,
      transcripts,
      workspacePath,
      summaryModel,
      timezone,
    });
  }

  const newEntry = await sessionStore.rotate(sessionKey, {
    channel: ctx.channel,
    chatType: ctx.chatType,
    groupId: ctx.groupId,
    displayName: ctx.senderName,
  });

  // Clear old transcript (after summary is saved)
  if (oldEntry?.sessionId) {
    await transcripts.clear(oldEntry.sessionId);
  }

  log.info(`Session rotated: ${oldEntry?.sessionId ?? "(none)"} → ${newEntry.sessionId}`);

  // Send confirmation (aligned with OpenClaw greeting format)
  const channel = channels.get(ctx.channel);
  if (channel) {
    const target =
      ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;

    // Build model label for greeting
    const activeModelLabel = modelSelection
      ? `${modelSelection.provider}/${modelSelection.model}`
      : defaultModelLabel;

    const modelInfo = activeModelLabel
      ? modelSelection && defaultModelLabel && activeModelLabel !== defaultModelLabel
        ? ` · model: ${activeModelLabel} (default: ${defaultModelLabel})`
        : ` · model: ${activeModelLabel}`
      : "";

    const memorySuffix = summaryResult.summarized
      ? "\n📝 对话摘要已保存到记忆文件。"
      : "";

    let greeting: string;
    if (bodyAfterModel) {
      greeting = `✅ New session started${modelInfo}${memorySuffix}\n${bodyAfterModel}`;
    } else {
      greeting = `✅ New session started${modelInfo}${memorySuffix}`;
    }

    await channel.send(target, {
      text: greeting,
      replyToId: ctx.messageId,
    });
  }

  return { handled: true };
}
