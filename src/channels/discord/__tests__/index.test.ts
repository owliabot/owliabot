import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDiscordPlugin } from "../index.js";

vi.mock("discord.js", () => {
  let lastClient: any;

  class MockClient {
    handlers: Record<string, any> = {};
    login = vi.fn().mockResolvedValue("ok");
    destroy = vi.fn();
    on = vi.fn((event: string, handler: any) => {
      this.handlers[event] = handler;
    });
    once = vi.fn((event: string, handler: any) => {
      this.handlers[event] = handler;
    });
    channels = {
      fetch: vi.fn(),
    };
    users = {
      fetch: vi.fn(),
    };
    user = { id: "bot123" };

    constructor() {
      lastClient = this;
    }
  }

  return {
    Client: MockClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      DirectMessages: 4,
      MessageContent: 8,
    },
    Events: {
      MessageCreate: "messageCreate",
      ClientReady: "ready",
    },
    Partials: {
      Channel: 0,
      Message: 1,
    },
    __getLastClient: () => lastClient,
  };
});

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makeMessage = (overrides: Partial<any> = {}) => {
  const base: any = {
    author: {
      id: "user1",
      bot: false,
      displayName: "User One",
      username: "user1",
    },
    guild: undefined,
    channel: {
      id: "channel-1",
      sendTyping: vi.fn().mockResolvedValue(undefined),
      messages: {
        fetch: vi.fn().mockRejectedValue(new Error("not found")),
      },
    },
    content: "Hello",
    createdTimestamp: 123456,
    id: "msg-1",
    reference: undefined,
    mentions: { has: vi.fn(() => false) },
    ...overrides,
  };
  // Merge channel deeply if overrides provide it
  if (overrides.channel) {
    base.channel = {
      ...base.channel,
      ...overrides.channel,
      messages: {
        fetch: vi.fn().mockRejectedValue(new Error("not found")),
        ...(overrides.channel.messages || {}),
      },
    };
  }
  // Build fetchReference from channel.messages.fetch if not explicitly provided
  if (!base.fetchReference) {
    const msgFetch = base.channel.messages.fetch;
    base.fetchReference = vi.fn((...args: any[]) => msgFetch(base.reference?.messageId));
  }
  return base;
};

describe("discord plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches direct messages to the handler", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();
    const message = makeMessage({ content: "Hi there" });

    await client.handlers.messageCreate(message);

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.body).toBe("Hi there");
    expect(ctx.chatType).toBe("direct");
    expect(ctx.channel).toBe("discord");
  });

  it("enforces member allow list", async () => {
    const plugin = createDiscordPlugin({
      token: "test-token",
      memberAllowList: ["allowed-user"],
    });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();
    const message = makeMessage({ author: { id: "blocked", bot: false, username: "blocked" } });

    await client.handlers.messageCreate(message);

    expect(handler).not.toHaveBeenCalled();
  });

  it("requires mentions in guilds by default and strips mention tokens", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();

    const noMention = makeMessage({
      guild: { name: "Guild" },
      channel: { id: "channel-2", sendTyping: vi.fn().mockResolvedValue(undefined) },
    });
    await client.handlers.messageCreate(noMention);
    expect(handler).not.toHaveBeenCalled();

    const mentionMessage = makeMessage({
      guild: { name: "Guild" },
      channel: { id: "channel-2", sendTyping: vi.fn().mockResolvedValue(undefined) },
      content: "<@123> Hello bot",
      mentions: { has: vi.fn(() => true) },
    });
    await client.handlers.messageCreate(mentionMessage);

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.body).toBe("Hello bot");
    expect(ctx.chatType).toBe("group");
    expect(ctx.groupId).toBe("channel-2");
  });

  it("applies channel allow list when mentions are not required", async () => {
    const plugin = createDiscordPlugin({
      token: "test-token",
      requireMentionInGuild: false,
      channelAllowList: ["allowed-channel"],
    });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();

    const blocked = makeMessage({
      guild: { name: "Guild" },
      channel: { id: "blocked-channel", sendTyping: vi.fn().mockResolvedValue(undefined) },
    });
    await client.handlers.messageCreate(blocked);
    expect(handler).not.toHaveBeenCalled();

    const allowed = makeMessage({
      guild: { name: "Guild" },
      channel: { id: "allowed-channel", sendTyping: vi.fn().mockResolvedValue(undefined) },
    });
    await client.handlers.messageCreate(allowed);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("sends to a text channel when available", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();
    const send = vi.fn();
    client.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      send,
    });

    await plugin.send("channel-123", { text: "Ping", replyToId: "msg-9" });

    expect(send).toHaveBeenCalledWith({
      content: "Ping",
      reply: { messageReference: "msg-9" },
    });
  });

  it("treats reply-to-bot as mention trigger in guild", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();

    const replyToBot = makeMessage({
      guild: { name: "Guild" },
      channel: {
        id: "channel-2",
        sendTyping: vi.fn().mockResolvedValue(undefined),
        messages: {
          fetch: vi.fn().mockResolvedValue({ author: { id: "bot123" } }),
        },
      },
      reference: { messageId: "bot-msg-1" },
    });
    await client.handlers.messageCreate(replyToBot);
    expect(handler).toHaveBeenCalledTimes(1);
    // The mentioned field in MsgContext should be true for reply-to-bot
    expect(handler.mock.calls[0][0].mentioned).toBe(true);
  });

  it("does NOT trigger when replying to another user's message", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();

    const replyToOther = makeMessage({
      guild: { name: "Guild" },
      channel: {
        id: "channel-2",
        sendTyping: vi.fn().mockResolvedValue(undefined),
        messages: {
          fetch: vi.fn().mockResolvedValue({ author: { id: "other-user" } }),
        },
      },
      reference: { messageId: "other-msg-1" },
    });
    await client.handlers.messageCreate(replyToOther);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT trigger guild message with neither reply nor mention", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });
    const handler = vi.fn();
    plugin.onMessage(handler);

    await plugin.start();

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();

    const plainMsg = makeMessage({
      guild: { name: "Guild" },
      channel: {
        id: "channel-2",
        sendTyping: vi.fn().mockResolvedValue(undefined),
      },
    });
    await client.handlers.messageCreate(plainMsg);
    expect(handler).not.toHaveBeenCalled();
  });

  it("falls back to DM send when channel fetch fails", async () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    const discord = (await import("discord.js")) as any;
    const client = discord.__getLastClient();
    const dmSend = vi.fn();
    client.channels.fetch.mockResolvedValue(null);
    client.users.fetch.mockResolvedValue({
      createDM: async () => ({
        send: dmSend,
      }),
    });

    await plugin.send("user-123", { text: "Hello" });

    expect(dmSend).toHaveBeenCalledWith({
      content: "Hello",
      reply: undefined,
    });
  });
});
