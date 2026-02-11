import { describe, it, expect } from "vitest";
import {
  truncateToolResult,
  estimateTokens,
  estimateContextTokens,
  guardContext,
  calculateMaxToolResultChars,
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  TRUNCATE_HEAD_CHARS,
  TRUNCATE_TAIL_CHARS,
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_RESERVE_TOKENS,
} from "../context-guard.js";
import type { Message } from "../session.js";

// ── Helper ─────────────────────────────────────────────────

function makeMessage(
  role: Message["role"],
  content: string,
  extra?: Partial<Message>,
): Message {
  return { role, content, timestamp: Date.now(), ...extra };
}

function repeat(char: string, n: number): string {
  return char.repeat(n);
}

// ── truncateToolResult ─────────────────────────────────────

describe("truncateToolResult", () => {
  it("returns short text unchanged", () => {
    const text = "hello world";
    expect(truncateToolResult(text)).toBe(text);
  });

  it("returns text at exactly maxChars unchanged", () => {
    const text = repeat("a", DEFAULT_TOOL_RESULT_MAX_CHARS);
    expect(truncateToolResult(text)).toBe(text);
  });

  it("truncates text at maxChars + 1", () => {
    const text = repeat("a", DEFAULT_TOOL_RESULT_MAX_CHARS + 1);
    const result = truncateToolResult(text);
    expect(result).not.toBe(text);
    expect(result).toContain("characters truncated");
    expect(result.startsWith(repeat("a", TRUNCATE_HEAD_CHARS))).toBe(true);
    expect(result.endsWith(repeat("a", TRUNCATE_TAIL_CHARS))).toBe(true);
  });

  it("truncates long text with head + tail + marker", () => {
    const text = repeat("x", 100_000);
    const result = truncateToolResult(text);
    const omitted = 100_000 - TRUNCATE_HEAD_CHARS - TRUNCATE_TAIL_CHARS;
    expect(result).toContain(`[${omitted} characters truncated]`);
  });

  it("respects custom maxChars", () => {
    const text = repeat("b", 200);
    const result = truncateToolResult(text, 100);
    expect(result).toContain("characters truncated");
  });
});

// ── estimateTokens ─────────────────────────────────────────

describe("estimateTokens", () => {
  it("estimates tokens as ceil(length / CHARS_PER_TOKEN)", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(repeat("a", 9))).toBe(3);
    expect(estimateTokens(repeat("a", 10))).toBe(4);
  });
});

// ── estimateContextTokens ──────────────────────────────────

describe("estimateContextTokens", () => {
  it("sums content tokens", () => {
    const msgs: Message[] = [
      makeMessage("user", repeat("a", 30)),
      makeMessage("assistant", repeat("b", 60)),
    ];
    expect(estimateContextTokens(msgs)).toBe(
      Math.ceil(30 / DEFAULT_CHARS_PER_TOKEN) +
        Math.ceil(60 / DEFAULT_CHARS_PER_TOKEN),
    );
  });

  it("includes toolCalls in estimate", () => {
    const toolCalls = [{ id: "1", name: "test", arguments: { x: 1 } }];
    const msgs: Message[] = [makeMessage("assistant", "ok", { toolCalls })];
    const serialized = JSON.stringify(toolCalls);
    expect(estimateContextTokens(msgs)).toBe(
      estimateTokens("ok") + estimateTokens(serialized),
    );
  });

  it("includes toolResults in estimate", () => {
    const toolResults = [
      { success: true as const, data: { result: "big" }, toolCallId: "1", toolName: "t" },
    ];
    const msgs: Message[] = [makeMessage("user", "", { toolResults })];
    const serialized = JSON.stringify(toolResults[0].data);
    expect(estimateContextTokens(msgs)).toBe(
      estimateTokens("") + estimateTokens(serialized),
    );
  });

  it("handles error toolResults", () => {
    const toolResults = [
      { success: false as const, error: "boom", toolCallId: "1", toolName: "t" },
    ];
    const msgs: Message[] = [makeMessage("user", "", { toolResults })];
    expect(estimateContextTokens(msgs)).toBe(
      estimateTokens("") + estimateTokens("boom"),
    );
  });
});

// ── guardContext ────────────────────────────────────────────

describe("guardContext", () => {
  it("returns empty messages unchanged", () => {
    const result = guardContext([], { contextWindow: 200_000 });
    expect(result.messages).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  it("keeps only system prompt when no chat messages", () => {
    const msgs = [makeMessage("system", "you are helpful")];
    const result = guardContext(msgs, { contextWindow: 200_000 });
    expect(result.messages).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it("returns short conversation unchanged", () => {
    const msgs: Message[] = [
      makeMessage("system", "sys"),
      makeMessage("user", "hi"),
      makeMessage("assistant", "hello"),
    ];
    const result = guardContext(msgs, { contextWindow: 200_000 });
    expect(result.messages).toHaveLength(3);
    expect(result.dropped).toBe(0);
  });

  it("drops oldest non-system messages when over budget", () => {
    const sys = makeMessage("system", "sys");
    // Each message ~3334 tokens (10000 chars / 3)
    const old1 = makeMessage("user", repeat("a", 10_000));
    const old2 = makeMessage("assistant", repeat("b", 10_000));
    const recent = makeMessage("user", repeat("c", 10_000));

    // Budget: contextWindow(12000) - reserve(8192) - system(1) ≈ 3807
    // Each msg ~3334 tokens, so only 1 fits
    const result = guardContext([sys, old1, old2, recent], {
      contextWindow: 12_000,
      reserveTokens: DEFAULT_RESERVE_TOKENS,
    });

    expect(result.dropped).toBe(2);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1]).toBe(recent); // newest kept
  });

  it("always keeps system prompt", () => {
    const sys = makeMessage("system", repeat("s", 30_000));
    const user = makeMessage("user", "hi");
    const result = guardContext([sys, user], { contextWindow: 200_000 });
    expect(result.messages.some((m) => m.role === "system")).toBe(true);
  });

  it("keeps at least one non-system message even if over budget", () => {
    const sys = makeMessage("system", "sys");
    const huge = makeMessage("user", repeat("x", 1_000_000));

    const result = guardContext([sys, huge], {
      contextWindow: 1_000,
      reserveTokens: 500,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.dropped).toBe(0);
  });

  it("truncates tool results in messages", () => {
    const longData = repeat("d", 100_000);
    const assistant = makeMessage("assistant", "calling tool", {
      toolCalls: [{ id: "tool-1", name: "t", arguments: {} }],
    });
    const toolResult = makeMessage("user", "", {
      toolResults: [
        { success: true, data: longData, toolCallId: "tool-1", toolName: "t" },
      ],
    });
    const result = guardContext([assistant, toolResult], {
      contextWindow: 200_000,
      maxToolResultChars: 10_000,
    });

    // The tool result data should have been truncated
    const resultMsg = result.messages.find((m) => m.toolResults);
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.toolResults).toBeDefined();
    const tr = resultMsg!.toolResults![0];
    expect(typeof tr.data).toBe("string");
    expect((tr.data as string).length).toBeLessThan(100_000);
    expect((tr.data as string)).toContain("characters truncated");
  });

  it("reports correct dropped count", () => {
    const sys = makeMessage("system", "s");
    const msgs: Message[] = [sys];
    for (let i = 0; i < 10; i++) {
      msgs.push(makeMessage("user", repeat("u", 5_000)));
    }

    // Very tight budget
    const result = guardContext(msgs, {
      contextWindow: 5_000,
      reserveTokens: 1_000,
    });

    expect(result.dropped).toBe(10 - (result.messages.length - 1));
    expect(result.dropped).toBeGreaterThan(0);
  });

  it("preserves tool-call pairing when dropping messages", () => {
    const sys = makeMessage("system", "sys");
    const old1 = makeMessage("user", "old user message");
    const old2 = makeMessage("assistant", "old assistant", {
      toolCalls: [{ id: "call-1", name: "tool1", arguments: {} }],
    });
    const old3 = makeMessage("user", "", {
      toolResults: [
        { success: true, data: "result1", toolCallId: "call-1", toolName: "tool1" },
      ],
    });
    const recent1 = makeMessage("user", repeat("u", 5_000));
    const recent2 = makeMessage("assistant", repeat("a", 5_000));

    // Budget allows recent messages but not old messages
    const result = guardContext([sys, old1, old2, old3, recent1, recent2], {
      contextWindow: 8_000,
      reserveTokens: 1_000,
    });

    // Verify old2 and old3 are both dropped (since they're both old)
    // The key test: if old3 were somehow kept, old2 should also be kept
    const keptMessages = result.messages.filter((m) => m.role !== "system");
    const hasOld2 = keptMessages.some((m) => m === old2);
    const hasOld3Message = keptMessages.find((m) => m === old3);
    
    // If old3 is in the list, check if it still has toolResults
    if (hasOld3Message && hasOld3Message.toolResults && hasOld3Message.toolResults.length > 0) {
      // If old3 kept its tool result, old2 must be present
      expect(hasOld2).toBe(true);
    }
    
    // More robust check: no orphaned tool results
    const allToolCallIds = new Set<string>();
    for (const msg of result.messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          allToolCallIds.add(tc.id);
        }
      }
    }
    
    for (const msg of result.messages) {
      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          if (tr.toolCallId) {
            expect(allToolCallIds.has(tr.toolCallId)).toBe(true);
          }
        }
      }
    }
  });

  it("removes orphaned tool results when assistant is dropped", () => {
    const sys = makeMessage("system", "sys");
    const assistant = makeMessage("assistant", "response", {
      toolCalls: [{ id: "call-orphan", name: "tool", arguments: {} }],
    });
    const toolResult = makeMessage("user", "", {
      toolResults: [
        { success: true, data: "data", toolCallId: "call-orphan", toolName: "tool" },
      ],
    });
    const recent = makeMessage("user", repeat("u", 10_000));

    // Drop assistant but keep toolResult initially
    const result = guardContext([sys, assistant, toolResult, recent], {
      contextWindow: 5_000,
      reserveTokens: 1_000,
    });

    // Tool result should be filtered out since assistant was dropped
    const keptToolResult = result.messages.find((m) => m === toolResult);
    if (keptToolResult?.toolResults) {
      expect(keptToolResult.toolResults.length).toBe(0);
    }
  });

  it("handles all system messages over budget", () => {
    // Edge case: system messages alone exceed budget
    const sys1 = makeMessage("system", repeat("s", 50_000));
    const sys2 = makeMessage("system", repeat("s", 50_000));
    const user = makeMessage("user", "hi");

    const result = guardContext([sys1, sys2, user], {
      contextWindow: 10_000,
      reserveTokens: 2_000,
    });

    // Should still keep system messages and at least one chat message
    expect(result.messages.filter((m) => m.role === "system").length).toBe(2);
    expect(result.messages.some((m) => m.role === "user")).toBe(true);
  });
});

// ── calculateMaxToolResultChars ───────────────────────────

describe("calculateMaxToolResultChars", () => {
  it("calculates 30% of available context as max tool result size", () => {
    const contextWindow = 200_000;
    const reserveTokens = 8_192;
    const max = calculateMaxToolResultChars(contextWindow, reserveTokens);
    
    const availableTokens = contextWindow - reserveTokens;
    const expectedTokens = Math.floor(availableTokens * 0.3);
    const expectedChars = expectedTokens * DEFAULT_CHARS_PER_TOKEN;
    
    expect(max).toBe(expectedChars);
  });

  it("uses default reserve tokens if not provided", () => {
    const contextWindow = 100_000;
    const max = calculateMaxToolResultChars(contextWindow);
    
    const availableTokens = contextWindow - DEFAULT_RESERVE_TOKENS;
    const expectedTokens = Math.floor(availableTokens * 0.3);
    const expectedChars = expectedTokens * DEFAULT_CHARS_PER_TOKEN;
    
    expect(max).toBe(expectedChars);
  });

  it("returns reasonable limits for small context windows", () => {
    const max = calculateMaxToolResultChars(10_000, 2_000);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(10_000 * DEFAULT_CHARS_PER_TOKEN);
  });
});
