import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramPlugin } from "../index.js";

vi.mock("grammy", () => {
  let lastBot: any;

  class MockBot {
    handlers: Record<string, any> = {};
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    use = vi.fn();
    on = vi.fn((event: string, handler: any) => {
      this.handlers[event] = handler;
    });
    api = {
      sendMessage: vi.fn(),
      setMessageReaction: vi.fn(),
    };

    constructor() {
      lastBot = this;
    }
  }

  return {
    Bot: MockBot,
    __getLastBot: () => lastBot,
  };
});

vi.mock("@grammyjs/auto-chat-action", () => ({
  autoChatAction: () => async (_ctx: any, next: () => Promise<void>) => { await next(); },
}));

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makeCtx = (overrides: Partial<any> = {}) => ({
  chat: { type: "private" },
  from: { id: 123, first_name: "Alice", username: "alice" },
  message: {
    text: "Hello",
    message_id: 42,
    date: 1700000000,
  },
  ...overrides,
});

describe("telegram plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches direct messages to the handler", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();
    const ctx = makeCtx({ message: { text: "Hi there", message_id: 1, date: 1700000000 } });

    await bot.handlers["message:text"](ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    const msgCtx = handler.mock.calls[0][0];
    expect(msgCtx.body).toBe("Hi there");
    expect(msgCtx.chatType).toBe("direct");
    expect(msgCtx.channel).toBe("telegram");
  });

  it("forwards non-allowlisted DMs to gateway (gateway handles unbound gating)", async () => {
    const plugin = createTelegramPlugin({
      token: "test-token",
      allowList: ["999"],
    });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();
    const ctx = makeCtx({ from: { id: 123, first_name: "Alice", username: "alice" } });

    await bot.handlers["message:text"](ctx);

    // Plugin no longer blocks — gateway is responsible for allowlist + onboard prompt
    expect(handler).toHaveBeenCalled();
  });

  it("dispatches group messages with group metadata", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();
    const ctx = makeCtx({ chat: { type: "group", id: -100999, title: "Test Group" } });

    await bot.handlers["message:text"](ctx);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        chatType: "group",
        groupId: "-100999",
        groupName: "Test Group",
      })
    );
  });

  it("does not apply allow list to group messages", async () => {
    const plugin = createTelegramPlugin({
      token: "test-token",
      allowList: ["999"], // does not include 123
    });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();
    const ctx = makeCtx({ chat: { type: "group", id: -100999, title: "Test Group" } });

    await bot.handlers["message:text"](ctx);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("extracts reply-to context into MsgContext", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();
    const ctx = makeCtx({
      chat: { type: "group", id: -100999, title: "Test Group" },
      message: {
        text: "@owlia 帮忙分析下",
        message_id: 100,
        date: 1700000000,
        reply_to_message: {
          text: "现在行情怎么样",
          message_id: 99,
          from: { id: 456, first_name: "Bob", username: "bob" },
        },
      },
    });

    await bot.handlers["message:text"](ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    const msgCtx = handler.mock.calls[0][0];
    expect(msgCtx.replyToBody).toBe("现在行情怎么样");
    expect(msgCtx.replyToSender).toBe("Bob");
  });

  it("sends markdown as HTML and falls back to plain text", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();

    const firstError = new Error("HTML parse error");
    bot.api.sendMessage
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(undefined);

    await plugin.send("123", { text: "**Bold** message", replyToId: "99" });

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.api.sendMessage).toHaveBeenNthCalledWith(
      1,
      123,
      "<b>Bold</b> message",
      { parse_mode: "HTML", reply_to_message_id: 99 }
    );
    expect(bot.api.sendMessage).toHaveBeenNthCalledWith(
      2,
      123,
      "**Bold** message",
      { reply_to_message_id: 99 }
    );
  });

  it("falls back to common reactions when emoji is invalid", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();

    bot.api.setMessageReaction
      .mockRejectedValueOnce({ error_code: 400, description: "Bad Request: REACTION_INVALID" })
      .mockResolvedValueOnce(undefined);

    await plugin.addReaction?.("123", "42", "✅");

    expect(bot.api.setMessageReaction).toHaveBeenCalledTimes(2);
    // First attempt uses the requested emoji.
    expect(bot.api.setMessageReaction.mock.calls[0][2][0].emoji).toBe("✅");
    // Second attempt uses a fallback (exact value may change, but should be an emoji string).
    expect(typeof bot.api.setMessageReaction.mock.calls[1][2][0].emoji).toBe("string");
    expect(bot.api.setMessageReaction.mock.calls[1][2][0].emoji).not.toBe("✅");
  });

  it("stops attempting reactions when reactions are not allowed in a chat", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();

    bot.api.setMessageReaction
      .mockRejectedValueOnce({ error_code: 400, description: "Bad Request: REACTIONS_NOT_ALLOWED" });

    await plugin.addReaction?.("123", "42", "🤔");
    await plugin.addReaction?.("123", "43", "🤔");

    // Second call should be skipped due to caching.
    expect(bot.api.setMessageReaction).toHaveBeenCalledTimes(1);
  });

  it("does not show typing unless the handler requests it", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const handler = vi.fn(async () => undefined);
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();

    const setCalls: any[] = [];
    const ctx = makeCtx({
      chat: { type: "group", id: -100999, title: "Test Group" },
      message: { text: "hello", message_id: 1, date: 1700000000 },
    });
    Object.defineProperty(ctx, "chatAction", {
      configurable: true,
      get: () => null,
      set: (v) => { setCalls.push(v); },
    });

    await bot.handlers["message:text"](ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    // No typing (no sets at all)
    expect(setCalls.length).toBe(0);
  });

  it("lets the handler control typing via MsgContext.setTyping()", async () => {
    const plugin = createTelegramPlugin({ token: "test-token" });
    const handler = vi.fn(async (msgCtx: any) => {
      msgCtx.setTyping?.(true);
      msgCtx.setTyping?.(false);
    });
    plugin.onMessage(handler);

    await plugin.start();

    const grammy = (await import("grammy")) as any;
    const bot = grammy.__getLastBot();

    const setCalls: any[] = [];
    const ctx = makeCtx({
      chat: { type: "group", id: -100999, title: "Test Group" },
      message: { text: "/start", message_id: 1, date: 1700000000 },
    });
    Object.defineProperty(ctx, "chatAction", {
      configurable: true,
      get: () => null,
      set: (v) => { setCalls.push(v); },
    });

    await bot.handlers["message:text"](ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(setCalls).toContain("typing");
    expect(setCalls).toContain(null);
  });
});
