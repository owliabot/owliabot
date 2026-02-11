/**
 * Context Window Guard
 * L1: Tool result truncation
 * L2: Context window aware history pruning
 * @see docs/design/context-window-guard-plan.md
 */

import { createLogger } from "../utils/logger.js";
import type { Message } from "./session.js";

const log = createLogger("context-guard");

// ── Constants ──────────────────────────────────────────────

/** Maximum characters for a single tool result */
export const DEFAULT_TOOL_RESULT_MAX_CHARS = 50_000;

/** Head characters to keep when truncating */
export const TRUNCATE_HEAD_CHARS = 2_000;

/** Tail characters to keep when truncating */
export const TRUNCATE_TAIL_CHARS = 2_000;

/** Reserve tokens for model output */
export const DEFAULT_RESERVE_TOKENS = 8_192;

/** Conservative chars-per-token estimate (handles CJK) */
export const DEFAULT_CHARS_PER_TOKEN = 3;

// ── Interfaces ─────────────────────────────────────────────

export interface GuardOptions {
  contextWindow: number;
  reserveTokens?: number;
  maxToolResultChars?: number;
}

// ── L1: Tool result truncation ─────────────────────────────

/**
 * Truncate text that exceeds maxChars, keeping head + tail with an omitted marker.
 */
export function truncateToolResult(
  text: string,
  maxChars: number = DEFAULT_TOOL_RESULT_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, TRUNCATE_HEAD_CHARS);
  const tail = text.slice(-TRUNCATE_TAIL_CHARS);
  const omitted = text.length - TRUNCATE_HEAD_CHARS - TRUNCATE_TAIL_CHARS;

  return `${head}\n\n... [${omitted} characters truncated] ...\n\n${tail}`;
}

// ── L2: Token estimation ───────────────────────────────────

/**
 * Estimate token count from text length (chars / 3, conservative for CJK).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / DEFAULT_CHARS_PER_TOKEN);
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateContextTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
    if (m.toolCalls) {
      total += estimateTokens(JSON.stringify(m.toolCalls));
    }
    if (m.toolResults) {
      for (const tr of m.toolResults) {
        total += estimateTokens(
          tr.success ? JSON.stringify(tr.data) : (tr.error ?? ""),
        );
      }
    }
  }
  return total;
}

// ── L2: History pruning ────────────────────────────────────

/**
 * Clone a message with its tool results truncated via L1.
 */
function truncateMessageToolResults(
  msg: Message,
  maxChars?: number,
): Message {
  if (!msg.toolResults || msg.toolResults.length === 0) return msg;

  const max = maxChars ?? DEFAULT_TOOL_RESULT_MAX_CHARS;
  return {
    ...msg,
    toolResults: msg.toolResults.map((tr) => {
      if (!tr.success) return tr;
      const serialized = JSON.stringify(tr.data, null, 2);
      if (serialized.length <= max) return tr;
      // Truncate by replacing data with the truncated string
      return {
        ...tr,
        data: truncateToolResult(serialized, max),
      };
    }),
  };
}

/**
 * Ensure messages fit within contextWindow - reserveTokens.
 * Drops oldest non-system messages first. Always keeps system messages
 * and at least one non-system message.
 * 
 * Critical: Maintains tool-call/tool-result pairing. If a tool_result is kept,
 * its corresponding assistant message with the tool_call must also be kept.
 */
export function guardContext(
  messages: Message[],
  options: GuardOptions,
): { messages: Message[]; dropped: number } {
  const budget =
    options.contextWindow - (options.reserveTokens ?? DEFAULT_RESERVE_TOKENS);

  // L1: truncate tool results in all messages
  const truncated = messages.map((m) =>
    truncateMessageToolResults(m, options.maxToolResultChars),
  );

  const systemMsgs = truncated.filter((m) => m.role === "system");
  const chatMsgs = truncated.filter((m) => m.role !== "system");

  if (chatMsgs.length === 0) {
    return { messages: systemMsgs, dropped: 0 };
  }

  const systemTokens = estimateContextTokens(systemMsgs);
  const remaining = budget - systemTokens;

  // Build a map of toolCallId -> assistant message index
  const toolCallIdToAssistantIndex = new Map<string, number>();
  for (let i = 0; i < chatMsgs.length; i++) {
    const msg = chatMsgs[i];
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolCallIdToAssistantIndex.set(tc.id, i);
      }
    }
  }

  // Walk backwards from newest, accumulating tokens
  let startIndex = chatMsgs.length;
  let accumulated = 0;
  const requiredIndices = new Set<number>(); // Indices that must be included for pairing

  for (let i = chatMsgs.length - 1; i >= 0; i--) {
    const msg = chatMsgs[i];
    const msgTokens = estimateContextTokens([msg]);
    
    // Check if this message references tool calls we need to preserve
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        if (!tr.toolCallId) continue; // Skip tool results without callId
        const assistantIndex = toolCallIdToAssistantIndex.get(tr.toolCallId);
        if (assistantIndex !== undefined && assistantIndex < i) {
          // Mark the assistant message as required
          requiredIndices.add(assistantIndex);
        }
      }
    }

    if (accumulated + msgTokens > remaining && startIndex < chatMsgs.length) {
      // Already have at least one message, stop here
      break;
    }
    accumulated += msgTokens;
    startIndex = i;
  }

  // Include required assistant messages that might be before startIndex
  for (const reqIdx of requiredIndices) {
    if (reqIdx < startIndex) {
      // Need to include messages from reqIdx
      const additionalTokens = estimateContextTokens(chatMsgs.slice(reqIdx, startIndex));
      accumulated += additionalTokens;
      startIndex = reqIdx;
    }
  }

  // Final pass: remove any orphaned tool_results whose assistant was dropped
  const keptMessages = chatMsgs.slice(startIndex);
  const keptToolCallIds = new Set<string>();
  
  // Collect all tool call IDs from kept assistant messages
  for (const msg of keptMessages) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        keptToolCallIds.add(tc.id);
      }
    }
  }

  // Filter out orphaned tool results
  const filteredMessages = keptMessages.map((msg) => {
    if (msg.toolResults) {
      const validResults = msg.toolResults.filter((tr) =>
        tr.toolCallId && keptToolCallIds.has(tr.toolCallId)
      );
      if (validResults.length !== msg.toolResults.length) {
        log.debug(
          `Removed ${msg.toolResults.length - validResults.length} orphaned tool results`
        );
        return { ...msg, toolResults: validResults.length > 0 ? validResults : undefined };
      }
    }
    return msg;
  });

  const dropped = chatMsgs.length - keptMessages.length;

  if (dropped > 0) {
    log.warn(
      `Context guard: dropped ${dropped} old messages to fit context window (${options.contextWindow} tokens)`,
    );
  }

  return {
    messages: [...systemMsgs, ...filteredMessages],
    dropped,
  };
}
