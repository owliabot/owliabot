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

const makeMessage = (overrides: Partial<any> = {}) => ({
  author: {
    id: "user1",
    bot: false,
    displayName: "User One",
    username: "user1",
  },
  guild: undefined,
  channel: { id: "channel-1" },
  content: "Hello",
  createdTimestamp: 123456,
  id: "msg-1",
  reference: undefined,
  mentions: { has: vi.fn(() => false) },
  ...overrides,
});

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
      channel: { id: "channel-2" },
    });
    await client.handlers.messageCreate(noMention);
    expect(handler).not.toHaveBeenCalled();

    const mentionMessage = makeMessage({
      guild: { name: "Guild" },
      channel: { id: "channel-2" },
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
      channel: { id: "blocked-channel" },
    });
    await client.handlers.messageCreate(blocked);
    expect(handler).not.toHaveBeenCalled();

    const allowed = makeMessage({
      guild: { name: "Guild" },
      channel: { id: "allowed-channel" },
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
