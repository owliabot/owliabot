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

  it("enforces allow list for direct messages", async () => {
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

    expect(handler).not.toHaveBeenCalled();
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
});
