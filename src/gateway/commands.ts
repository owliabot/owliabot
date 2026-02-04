// src/gateway/commands.ts
/**
 * Slash-command interceptor for the gateway message pipeline.
 *
 * Handles commands like /new, /reset before they reach the LLM agent loop.
 * Modeled after OpenClaw's resetTriggers behavior.
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
}

export interface CommandResult {
  /** Whether the command was handled (true = skip LLM loop). */
  handled: boolean;
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
  } = options;

  const body = ctx.body.trim();
  const triggers = resetTriggers ?? DEFAULT_RESET_TRIGGERS;

  // Check if the message starts with a reset trigger
  const matchedTrigger = triggers.find(
    (t) => body === t || body.startsWith(t + " ")
  );

  if (!matchedTrigger) {
    return { handled: false };
  }

  // Extract remainder after the trigger (e.g. "/new sonnet" → "sonnet")
  const remainder = body.slice(matchedTrigger.length).trim();

  log.info(`Reset command "${matchedTrigger}" from ${sessionKey}${remainder ? ` (remainder: "${remainder}")` : ""}`);

  // Rotate session (creates a new sessionId for this sessionKey)
  const oldEntry = await sessionStore.get(sessionKey);

  // Summarize transcript → memory before clearing (non-blocking on failure)
  let summaryResult: SummarizeResult = { summarized: false };
  if (oldEntry?.sessionId && workspacePath) {
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

  // Send confirmation
  const channel = channels.get(ctx.channel);
  if (channel) {
    const target =
      ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;

    const memorySuffix = summaryResult.summarized
      ? "\n📝 对话摘要已保存到记忆文件。"
      : "";

    const greeting = remainder
      ? `🆕 会话已重置。${memorySuffix ? memorySuffix + "\n" : ""}继续处理：${remainder}`
      : `🆕 新会话已开启，之前的对话记录已清除。${memorySuffix}有什么可以帮你的？`;

    await channel.send(target, {
      text: greeting,
      replyToId: ctx.messageId,
    });
  }

  return { handled: true };
}
