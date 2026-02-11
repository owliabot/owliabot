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
  truncateHeadChars?: number;
  truncateTailChars?: number;
}

// ── L1: Tool result truncation ─────────────────────────────

/**
 * Truncate text that exceeds maxChars, keeping head + tail with an omitted marker.
 */
export function truncateToolResult(
  text: string,
  maxChars: number = DEFAULT_TOOL_RESULT_MAX_CHARS,
  headChars: number = TRUNCATE_HEAD_CHARS,
  tailChars: number = TRUNCATE_TAIL_CHARS,
): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omitted = text.length - headChars - tailChars;

  return `${head}\n\n... [${omitted} characters truncated] ...\n\n${tail}`;
}

// ── Dynamic limits ─────────────────────────────────────────

/** Upper bound for single tool result (400KB) */
export const MAX_TOOL_RESULT_UPPER_BOUND = 400_000;

/**
 * Calculate maximum characters for a single tool result.
 * Similar to OpenClaw's approach: single tool result should not exceed
 * 30% of context window, capped at 400KB.
 * 
 * Formula: min(contextWindow * 0.3 * 4, 400000)
 * 
 * @param contextWindow - Total context window size in tokens
 * @param _reserveTokens - Unused (kept for backward compatibility)
 * @returns Maximum characters for a tool result
 */
export function calculateMaxToolResultChars(
  contextWindow: number,
  _reserveTokens?: number,
): number {
  // 30% of context window, assuming ~4 chars per token (more generous for tool results)
  const dynamicLimit = Math.floor(contextWindow * 0.3 * 4);
  return Math.min(dynamicLimit, MAX_TOOL_RESULT_UPPER_BOUND);
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
  headChars?: number,
  tailChars?: number,
): Message {
  if (!msg.toolResults || msg.toolResults.length === 0) return msg;

  const max = maxChars ?? DEFAULT_TOOL_RESULT_MAX_CHARS;
  const head = headChars ?? TRUNCATE_HEAD_CHARS;
  const tail = tailChars ?? TRUNCATE_TAIL_CHARS;
  return {
    ...msg,
    toolResults: msg.toolResults.map((tr) => {
      if (!tr.success) return tr;
      const serialized = JSON.stringify(tr.data, null, 2);
      if (serialized.length <= max) return tr;
      // Truncate by replacing data with the truncated string
      return {
        ...tr,
        data: truncateToolResult(serialized, max, head, tail),
      };
    }),
  };
}

/**
 * Ensure messages fit within contextWindow - reserveTokens.
 * Drops oldest non-system messages first. Always keeps system messages
 * and at least one non-system message.
 * 
 * Critical: Maintains tool-call/tool-result pairing. Assistant messages with
 * tool_calls and their corresponding tool_result messages are treated as
 * atomic groups — they are dropped or kept together.
 */
export function guardContext(
  messages: Message[],
  options: GuardOptions,
): { messages: Message[]; dropped: number } {
  const reserveTokens = options.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  const budget = options.contextWindow - reserveTokens;

  // Calculate dynamic max tool result size if not explicitly provided
  const maxToolResultChars = options.maxToolResultChars ?? 
    calculateMaxToolResultChars(options.contextWindow, reserveTokens);

  // L1: truncate tool results in all messages
  const truncated = messages.map((m) =>
    truncateMessageToolResults(
      m,
      maxToolResultChars,
      options.truncateHeadChars,
      options.truncateTailChars,
    ),
  );

  const systemMsgs = truncated.filter((m) => m.role === "system");
  const chatMsgs = truncated.filter((m) => m.role !== "system");

  if (chatMsgs.length === 0) {
    return { messages: systemMsgs, dropped: 0 };
  }

  const systemTokens = estimateContextTokens(systemMsgs);
  const remaining = budget - systemTokens;

  // Build atomic groups: assistant+toolCalls paired with subsequent toolResults
  // Group structure: { startIdx, endIdx, tokens }
  interface MsgGroup {
    startIdx: number;
    endIdx: number; // exclusive
    tokens: number;
  }
  
  const groups: MsgGroup[] = [];
  
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

  // Build a map of message index -> group start index (for tool result messages)
  const msgToGroupStart = new Map<number, number>();
  for (let i = 0; i < chatMsgs.length; i++) {
    const msg = chatMsgs[i];
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        if (!tr.toolCallId) continue;
        const assistantIndex = toolCallIdToAssistantIndex.get(tr.toolCallId);
        if (assistantIndex !== undefined && assistantIndex < i) {
          // This toolResult message belongs to the group starting at assistantIndex
          const existingGroupStart = msgToGroupStart.get(i);
          if (existingGroupStart === undefined || assistantIndex < existingGroupStart) {
            msgToGroupStart.set(i, assistantIndex);
          }
        }
      }
    }
  }

  // Now build groups: iterate through messages, grouping assistant+toolResults
  let i = 0;
  while (i < chatMsgs.length) {
    const msg = chatMsgs[i];
    
    // Check if this is an assistant message with toolCalls
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const groupStart = i;
      const toolCallIds = new Set(msg.toolCalls.map((tc) => tc.id));
      
      // Find all subsequent messages that are toolResults for these toolCalls
      let groupEnd = i + 1;
      while (groupEnd < chatMsgs.length) {
        const nextMsg = chatMsgs[groupEnd];
        if (nextMsg.toolResults) {
          const hasRelevantResult = nextMsg.toolResults.some(
            (tr) => tr.toolCallId && toolCallIds.has(tr.toolCallId)
          );
          if (hasRelevantResult) {
            groupEnd++;
            continue;
          }
        }
        break;
      }
      
      const groupMsgs = chatMsgs.slice(groupStart, groupEnd);
      groups.push({
        startIdx: groupStart,
        endIdx: groupEnd,
        tokens: estimateContextTokens(groupMsgs),
      });
      i = groupEnd;
    } else {
      // Standalone message (user message or assistant without toolCalls)
      groups.push({
        startIdx: i,
        endIdx: i + 1,
        tokens: estimateContextTokens([msg]),
      });
      i++;
    }
  }

  // Walk backwards from newest groups, accumulating tokens
  let startGroupIdx = groups.length;
  let accumulated = 0;

  for (let g = groups.length - 1; g >= 0; g--) {
    const group = groups[g];
    
    if (accumulated + group.tokens > remaining && startGroupIdx < groups.length) {
      // Already have at least one group, stop here
      break;
    }
    accumulated += group.tokens;
    startGroupIdx = g;
  }

  // Collect kept messages from selected groups
  const keptGroups = groups.slice(startGroupIdx);
  const keptMessages: Message[] = [];
  for (const group of keptGroups) {
    for (let idx = group.startIdx; idx < group.endIdx; idx++) {
      keptMessages.push(chatMsgs[idx]);
    }
  }

  // Count dropped messages
  const droppedGroups = groups.slice(0, startGroupIdx);
  let droppedCount = 0;
  for (const group of droppedGroups) {
    droppedCount += group.endIdx - group.startIdx;
  }

  if (droppedCount > 0) {
    log.warn(
      `Context guard: dropped ${droppedCount} old messages to fit context window (${options.contextWindow} tokens)`,
    );
  }

  return {
    messages: [...systemMsgs, ...keptMessages],
    dropped: droppedCount,
  };
}
