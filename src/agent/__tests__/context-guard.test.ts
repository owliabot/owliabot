import { describe, it, expect } from "vitest";
import {
  truncateToolResult,
  estimateTokens,
  estimateContextTokens,
  guardContext,
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
    const msg = makeMessage("user", "", {
      toolResults: [
        { success: true, data: longData, toolCallId: "1", toolName: "t" },
      ],
    });
    const result = guardContext([msg], {
      contextWindow: 200_000,
      maxToolResultChars: 10_000,
    });

    // The tool result data should have been truncated
    const tr = result.messages[0].toolResults![0];
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
});
