import { describe, it, expect, vi } from "vitest";
import { createDiscordPlugin } from "../index.js";

vi.mock("discord.js", () => {
  class MockClient {
    login = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
    channels = {
      fetch: vi.fn(),
    };
    user = { id: "bot123" };
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

describe("discord plugin", () => {
  it("should create discord plugin with required config", () => {
    const plugin = createDiscordPlugin({
      token: "test-token",
    });

    expect(plugin).toBeDefined();
    expect(plugin.id).toBe("discord");
    expect(plugin.capabilities).toBeDefined();
    expect(plugin.capabilities.reactions).toBe(true);
    expect(plugin.capabilities.markdown).toBe(true);
  });

  it("should have correct capabilities", () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    expect(plugin.capabilities.reactions).toBe(true);
    expect(plugin.capabilities.threads).toBe(true);
    expect(plugin.capabilities.buttons).toBe(true);
    expect(plugin.capabilities.markdown).toBe(true);
    expect(plugin.capabilities.maxMessageLength).toBe(2000);
  });

  it("should support member allow list", () => {
    const plugin = createDiscordPlugin({
      token: "test-token",
      memberAllowList: ["user1", "user2"],
    });

    expect(plugin).toBeDefined();
  });

  it("should support channel allow list", () => {
    const plugin = createDiscordPlugin({
      token: "test-token",
      channelAllowList: ["channel1", "channel2"],
    });

    expect(plugin).toBeDefined();
  });

  it("should support requireMentionInGuild option", () => {
    const plugin = createDiscordPlugin({
      token: "test-token",
      requireMentionInGuild: true,
    });

    expect(plugin).toBeDefined();
  });

  it("should support preFilter option", () => {
    const preFilter = vi.fn(() => true);
    const plugin = createDiscordPlugin({
      token: "test-token",
      preFilter,
    });

    expect(plugin).toBeDefined();
  });

  it("should have start method", () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    expect(typeof plugin.start).toBe("function");
  });

  it("should have stop method", () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    expect(typeof plugin.stop).toBe("function");
  });

  it("should have send method", () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    expect(typeof plugin.send).toBe("function");
  });

  it("should have onMessage method", () => {
    const plugin = createDiscordPlugin({ token: "test-token" });

    expect(typeof plugin.onMessage).toBe("function");
  });
});
