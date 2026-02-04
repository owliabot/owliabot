// src/gateway/__tests__/commands.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tryHandleCommand, resolveModelFromRemainder, type CommandContext } from "../commands.js";
import type { MsgContext } from "../../channels/interface.js";
import type { SessionStore, SessionEntry } from "../../agent/session-store.js";
import type { SessionTranscriptStore } from "../../agent/session-transcript.js";
import type { ChannelRegistry } from "../../channels/registry.js";

// Mock the session-summarizer module
vi.mock("../session-summarizer.js", () => ({
  summarizeAndSave: vi.fn().mockResolvedValue({ summarized: false }),
}));

import { summarizeAndSave } from "../session-summarizer.js";
const mockSummarize = summarizeAndSave as ReturnType<typeof vi.fn>;

function createMockCtx(overrides: Partial<MsgContext> = {}): MsgContext {
  return {
    from: "user123",
    senderName: "Test User",
    body: "/new",
    messageId: "msg-1",
    channel: "discord",
    chatType: "direct",
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockSessionStore(): SessionStore & {
  _rotated: Array<{ key: string; entry: SessionEntry }>;
} {
  const store: Record<string, SessionEntry> = {};
  const rotated: Array<{ key: string; entry: SessionEntry }> = [];

  return {
    _rotated: rotated,
    async get(key) {
      return store[key] ?? null;
    },
    async getOrCreate(key, meta) {
      if (!store[key]) {
        store[key] = {
          sessionId: "old-session-id",
          updatedAt: Date.now(),
          ...meta,
        };
      }
      return store[key];
    },
    async rotate(key, meta) {
      const oldEntry = store[key];
      const newEntry: SessionEntry = {
        sessionId: `new-session-${Date.now()}`,
        updatedAt: Date.now(),
        ...meta,
      };
      store[key] = newEntry;
      rotated.push({ key, entry: newEntry });
      return newEntry;
    },
    async listKeys() {
      return Object.keys(store);
    },
  };
}

function createMockTranscripts(): SessionTranscriptStore & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    async append() {},
    async readAll() { return []; },
    async getHistory() {
      return [];
    },
    async clear(sessionId) {
      cleared.push(sessionId);
    },
  };
}

function createMockChannels(): ChannelRegistry & { sent: Array<{ target: string; text: string }> } {
  const sent: Array<{ target: string; text: string }> = [];
  const mockChannel = {
    id: "discord" as const,
    async start() {},
    async stop() {},
    onMessage() {},
    async send(target: string, msg: { text: string }) {
      sent.push({ target, text: msg.text });
    },
    capabilities: {
      reactions: true,
      threads: true,
      buttons: false,
      markdown: true,
      maxMessageLength: 2000,
    },
  };

  return {
    sent,
    register() {},
    get(id: string) {
      return id === "discord" ? mockChannel : undefined;
    },
    async startAll() {},
    async stopAll() {},
    getAll() {
      return [mockChannel];
    },
  } as any;
}

describe("resolveModelFromRemainder", () => {
  it("should resolve known aliases", () => {
    expect(resolveModelFromRemainder("sonnet")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      alias: "sonnet",
    });
    expect(resolveModelFromRemainder("opus")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-5",
      alias: "opus",
    });
    expect(resolveModelFromRemainder("haiku")).toEqual({
      provider: "anthropic",
      model: "claude-3-5-haiku",
      alias: "haiku",
    });
  });

  it("should be case-insensitive for aliases", () => {
    expect(resolveModelFromRemainder("SONNET")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      alias: "sonnet",
    });
    expect(resolveModelFromRemainder("Opus")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-5",
      alias: "opus",
    });
  });

  it("should resolve provider/model format", () => {
    expect(resolveModelFromRemainder("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    expect(resolveModelFromRemainder("openai/gpt-4o")).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("should return null for unknown tokens", () => {
    expect(resolveModelFromRemainder("unknown")).toBeNull();
    expect(resolveModelFromRemainder("hello world")).toBeNull();
    expect(resolveModelFromRemainder("")).toBeNull();
  });
});

describe("tryHandleCommand", () => {
  let sessionStore: ReturnType<typeof createMockSessionStore>;
  let transcripts: ReturnType<typeof createMockTranscripts>;
  let channels: ReturnType<typeof createMockChannels>;

  beforeEach(() => {
    sessionStore = createMockSessionStore();
    transcripts = createMockTranscripts();
    channels = createMockChannels();
    mockSummarize.mockClear();
    mockSummarize.mockResolvedValue({ summarized: false });
  });

  function makeContext(ctx: MsgContext, overrides?: Partial<CommandContext>): CommandContext {
    return {
      ctx,
      sessionKey: "discord:user123",
      sessionStore,
      transcripts,
      channels,
      ...overrides,
    };
  }

  it("should handle /new command", async () => {
    const ctx = createMockCtx({ body: "/new" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(sessionStore._rotated).toHaveLength(1);
    expect(channels.sent).toHaveLength(1);
    expect(channels.sent[0].text).toContain("New session started");
  });

  it("should handle /reset command", async () => {
    const ctx = createMockCtx({ body: "/reset" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(sessionStore._rotated).toHaveLength(1);
    expect(channels.sent[0].text).toContain("New session started");
  });

  it("should pass through non-command messages", async () => {
    const ctx = createMockCtx({ body: "hello world" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(false);
    expect(sessionStore._rotated).toHaveLength(0);
    expect(channels.sent).toHaveLength(0);
  });

  it("should handle /new with remainder text", async () => {
    const ctx = createMockCtx({ body: "/new hello there" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("hello there");
  });

  it("should not match partial triggers (e.g. /newbie)", async () => {
    const ctx = createMockCtx({ body: "/newbie" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(false);
  });

  it("should clear old session transcripts", async () => {
    // Pre-populate an existing session
    await sessionStore.getOrCreate("discord:user123");

    const ctx = createMockCtx({ body: "/new" });
    await tryHandleCommand(makeContext(ctx));

    expect(transcripts.cleared).toContain("old-session-id");
  });

  it("should handle group chat (send to groupId)", async () => {
    const ctx = createMockCtx({
      body: "/new",
      chatType: "group",
      groupId: "group-456",
    });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].target).toBe("group-456");
  });

  it("should support custom reset triggers", async () => {
    const ctx = createMockCtx({ body: "/清除" });
    const result = await tryHandleCommand(
      makeContext(ctx, { resetTriggers: ["/清除"] })
    );

    expect(result.handled).toBe(true);
    expect(sessionStore._rotated).toHaveLength(1);
  });

  it("should not match default triggers when custom triggers are set", async () => {
    const ctx = createMockCtx({ body: "/new" });
    const result = await tryHandleCommand(
      makeContext(ctx, { resetTriggers: ["/清除"] })
    );

    expect(result.handled).toBe(false);
  });

  it("should handle whitespace-only body after trigger", async () => {
    const ctx = createMockCtx({ body: "/new   " });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("New session started");
  });

  // --- Case-insensitive matching tests ---

  it("should match triggers case-insensitively", async () => {
    const ctx = createMockCtx({ body: "/NEW" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
  });

  it("should match mixed-case triggers", async () => {
    const ctx = createMockCtx({ body: "/New sonnet" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
  });

  // --- Authorization tests ---

  it("should allow reset when no authorizedSenders configured", async () => {
    const ctx = createMockCtx({ body: "/new", from: "anyone" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
  });

  it("should allow reset for authorized sender", async () => {
    const ctx = createMockCtx({ body: "/new", from: "admin123" });
    const result = await tryHandleCommand(
      makeContext(ctx, { authorizedSenders: ["admin123", "admin456"] })
    );

    expect(result.handled).toBe(true);
  });

  it("should block reset for unauthorized sender", async () => {
    const ctx = createMockCtx({ body: "/new", from: "random-user" });
    const result = await tryHandleCommand(
      makeContext(ctx, { authorizedSenders: ["admin123"] })
    );

    expect(result.handled).toBe(false);
    expect(sessionStore._rotated).toHaveLength(0);
  });

  // --- Model override tests ---

  it("should parse model alias from remainder", async () => {
    const ctx = createMockCtx({ body: "/new sonnet" });
    const result = await tryHandleCommand(
      makeContext(ctx, { defaultModelLabel: "anthropic/claude-opus-4-5" })
    );

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("anthropic/claude-sonnet-4-5");
    expect(channels.sent[0].text).toContain("(default: anthropic/claude-opus-4-5)");
  });

  it("should parse model alias case-insensitively", async () => {
    const ctx = createMockCtx({ body: "/new HAIKU" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("anthropic/claude-3-5-haiku");
  });

  it("should parse provider/model format", async () => {
    const ctx = createMockCtx({ body: "/new openai/gpt-4o" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("openai/gpt-4o");
  });

  it("should pass remaining text after model", async () => {
    const ctx = createMockCtx({ body: "/new sonnet help me with X" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("help me with X");
  });

  it("should not parse unknown token as model", async () => {
    const ctx = createMockCtx({ body: "/new hello world" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    // "hello" is not a model, so full remainder should be in greeting
    expect(channels.sent[0].text).toContain("hello world");
    expect(channels.sent[0].text).not.toContain("provider");
  });

  // --- Greeting format tests ---

  it("should show model info in greeting when defaultModelLabel provided", async () => {
    const ctx = createMockCtx({ body: "/new" });
    const result = await tryHandleCommand(
      makeContext(ctx, { defaultModelLabel: "anthropic/claude-sonnet-4-5" })
    );

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("model: anthropic/claude-sonnet-4-5");
  });

  it("should not show default label when model matches default", async () => {
    const ctx = createMockCtx({ body: "/new sonnet" });
    const result = await tryHandleCommand(
      makeContext(ctx, { defaultModelLabel: "anthropic/claude-sonnet-4-5" })
    );

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).not.toContain("(default:");
  });

  // --- Memory summarization tests ---

  it("should call summarizeAndSave when workspacePath is provided", async () => {
    await sessionStore.getOrCreate("discord:user123");
    mockSummarize.mockResolvedValue({ summarized: true, summary: "- test summary" });

    const ctx = createMockCtx({ body: "/new" });
    await tryHandleCommand(
      makeContext(ctx, { workspacePath: "/tmp/workspace" })
    );

    expect(mockSummarize).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "old-session-id",
        workspacePath: "/tmp/workspace",
      })
    );
  });

  it("should NOT call summarizeAndSave when workspacePath is missing", async () => {
    await sessionStore.getOrCreate("discord:user123");
    mockSummarize.mockClear();

    const ctx = createMockCtx({ body: "/new" });
    await tryHandleCommand(makeContext(ctx));

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("should NOT call summarizeAndSave when summarizeOnReset is false", async () => {
    await sessionStore.getOrCreate("discord:user123");
    mockSummarize.mockClear();

    const ctx = createMockCtx({ body: "/new" });
    await tryHandleCommand(
      makeContext(ctx, { workspacePath: "/tmp/workspace", summarizeOnReset: false })
    );

    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("should include memory saved note in greeting when summary was produced", async () => {
    await sessionStore.getOrCreate("discord:user123");
    mockSummarize.mockResolvedValue({ summarized: true, summary: "- items" });

    const ctx = createMockCtx({ body: "/new" });
    await tryHandleCommand(
      makeContext(ctx, { workspacePath: "/tmp/workspace" })
    );

    expect(channels.sent[0].text).toContain("📝 对话摘要已保存到记忆文件");
  });

  it("should NOT include memory note when summary was skipped", async () => {
    await sessionStore.getOrCreate("discord:user123");
    mockSummarize.mockResolvedValue({ summarized: false });

    const ctx = createMockCtx({ body: "/new" });
    await tryHandleCommand(
      makeContext(ctx, { workspacePath: "/tmp/workspace" })
    );

    expect(channels.sent[0].text).not.toContain("📝");
  });
});
