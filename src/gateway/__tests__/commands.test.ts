// src/gateway/__tests__/commands.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tryHandleCommand, type CommandContext } from "../commands.js";
import type { MsgContext } from "../../channels/interface.js";
import type { SessionStore, SessionEntry } from "../../agent/session-store.js";
import type { SessionTranscriptStore } from "../../agent/session-transcript.js";
import type { ChannelRegistry } from "../../channels/registry.js";

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

describe("tryHandleCommand", () => {
  let sessionStore: ReturnType<typeof createMockSessionStore>;
  let transcripts: ReturnType<typeof createMockTranscripts>;
  let channels: ReturnType<typeof createMockChannels>;

  beforeEach(() => {
    sessionStore = createMockSessionStore();
    transcripts = createMockTranscripts();
    channels = createMockChannels();
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
    expect(channels.sent[0].text).toContain("新会话已开启");
  });

  it("should handle /reset command", async () => {
    const ctx = createMockCtx({ body: "/reset" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(sessionStore._rotated).toHaveLength(1);
    expect(channels.sent[0].text).toContain("新会话已开启");
  });

  it("should pass through non-command messages", async () => {
    const ctx = createMockCtx({ body: "hello world" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(false);
    expect(sessionStore._rotated).toHaveLength(0);
    expect(channels.sent).toHaveLength(0);
  });

  it("should handle /new with remainder text", async () => {
    const ctx = createMockCtx({ body: "/new sonnet" });
    const result = await tryHandleCommand(makeContext(ctx));

    expect(result.handled).toBe(true);
    expect(channels.sent[0].text).toContain("sonnet");
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
    expect(channels.sent[0].text).toContain("新会话已开启");
  });
});
