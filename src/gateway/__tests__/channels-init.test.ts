// src/gateway/__tests__/channels-init.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initializeChannels,
  startChannels,
  stopChannels,
} from "../channels-init.js";
import { ChannelRegistry } from "../../channels/registry.js";

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Telegram plugin
const mockTelegramOnMessage = vi.fn();
const mockTelegramPlugin = {
  id: "telegram",
  onMessage: mockTelegramOnMessage,
  start: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(),
};

vi.mock("../../channels/telegram/index.js", () => ({
  createTelegramPlugin: vi.fn(() => mockTelegramPlugin),
}));

// Mock Discord plugin
const mockDiscordOnMessage = vi.fn();
const mockDiscordPlugin = {
  id: "discord",
  onMessage: mockDiscordOnMessage,
  start: vi.fn(),
  stop: vi.fn(),
  send: vi.fn(),
};

vi.mock("../../channels/discord/index.js", () => ({
  createDiscordPlugin: vi.fn(() => mockDiscordPlugin),
}));

// Mock WriteGate adapter
vi.mock("../../security/write-gate-adapter.js", () => {
  return {
    WriteGateReplyRouter: class {
      tryRoute = vi.fn(() => false);
      hasPendingWaiter = vi.fn(() => false);
    },
    createWriteGateChannelAdapter: vi.fn(() => ({
      send: vi.fn(),
    })),
  };
});

describe("channels-init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTelegramOnMessage.mockReset();
    mockDiscordOnMessage.mockReset();
  });

  describe("initializeChannels", () => {
    it("returns empty registry when no channels configured", () => {
      const onMessage = vi.fn();
      const result = initializeChannels({}, onMessage);

      expect(result.registry.getAll()).toHaveLength(0);
      expect(result.writeGateChannels.size).toBe(0);
    });

    it("registers Telegram channel when token provided", async () => {
      const { createTelegramPlugin } = await import("../../channels/telegram/index.js");
      const onMessage = vi.fn();

      const result = initializeChannels(
        { telegram: { token: "test-token", allowList: ["user1"] } },
        onMessage
      );

      expect(createTelegramPlugin).toHaveBeenCalledWith({
        token: "test-token",
        allowList: ["user1"],
      });
      expect(result.registry.get("telegram")).toBe(mockTelegramPlugin);
      expect(result.writeGateChannels.has("telegram")).toBe(true);
    });

    it("registers Discord channel when token provided", async () => {
      const { createDiscordPlugin } = await import("../../channels/discord/index.js");
      const onMessage = vi.fn();

      const result = initializeChannels(
        {
          discord: {
            token: "discord-token",
            memberAllowList: ["member1"],
            channelAllowList: ["channel1"],
            requireMentionInGuild: true,
          },
        },
        onMessage
      );

      expect(createDiscordPlugin).toHaveBeenCalledWith({
        token: "discord-token",
        memberAllowList: ["member1"],
        channelAllowList: ["channel1"],
        requireMentionInGuild: true,
        preFilter: expect.any(Function),
      });
      expect(result.registry.get("discord")).toBe(mockDiscordPlugin);
      expect(result.writeGateChannels.has("discord")).toBe(true);
    });

    it("registers both channels when both configured", () => {
      const onMessage = vi.fn();

      const result = initializeChannels(
        {
          telegram: { token: "tg-token" },
          discord: { token: "dc-token" },
        },
        onMessage
      );

      expect(result.registry.getAll()).toHaveLength(2);
      expect(result.writeGateChannels.size).toBe(2);
    });

    it("skips Telegram when token is missing", async () => {
      const { createTelegramPlugin } = await import("../../channels/telegram/index.js");
      const onMessage = vi.fn();

      const result = initializeChannels(
        { telegram: { token: "" } }, // Empty token
        onMessage
      );

      expect(createTelegramPlugin).not.toHaveBeenCalled();
      expect(result.registry.get("telegram")).toBeUndefined();
    });

    it("skips Discord when token is missing", async () => {
      const { createDiscordPlugin } = await import("../../channels/discord/index.js");
      const onMessage = vi.fn();

      const result = initializeChannels(
        { discord: { token: undefined } as any }, // Undefined token
        onMessage
      );

      expect(createDiscordPlugin).not.toHaveBeenCalled();
      expect(result.registry.get("discord")).toBeUndefined();
    });

    it("sets up message handler for Telegram", () => {
      const onMessage = vi.fn();

      initializeChannels({ telegram: { token: "token" } }, onMessage);

      expect(mockTelegramOnMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it("sets up message handler for Discord", () => {
      const onMessage = vi.fn();

      initializeChannels({ discord: { token: "token" } }, onMessage);

      expect(mockDiscordOnMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it("creates WriteGate adapter for each channel", async () => {
      const { createWriteGateChannelAdapter } = await import(
        "../../security/write-gate-adapter.js"
      );
      const onMessage = vi.fn();

      initializeChannels(
        {
          telegram: { token: "token" },
          discord: { token: "token" },
        },
        onMessage
      );

      expect(createWriteGateChannelAdapter).toHaveBeenCalledTimes(2);
    });

    it("creates shared reply router", () => {
      const onMessage = vi.fn();

      const result = initializeChannels(
        { telegram: { token: "token" } },
        onMessage
      );

      expect(result.replyRouter).toBeDefined();
    });

    it("invokes onMessage callback when message received", async () => {
      const onMessage = vi.fn();

      initializeChannels({ telegram: { token: "token" } }, onMessage);

      // Get the registered handler
      const handler = mockTelegramOnMessage.mock.calls[0][0];
      const ctx = { channel: "telegram", body: "hello", from: "user1" };

      await handler(ctx);

      expect(onMessage).toHaveBeenCalledWith(ctx);
    });
  });

  describe("startChannels", () => {
    it("calls startAll on registry", async () => {
      const registry = new ChannelRegistry();
      registry.register(mockTelegramPlugin);
      const startAllSpy = vi.spyOn(registry, "startAll");

      await startChannels(registry);

      expect(startAllSpy).toHaveBeenCalled();
    });
  });

  describe("stopChannels", () => {
    it("calls stopAll on registry", async () => {
      const registry = new ChannelRegistry();
      registry.register(mockTelegramPlugin);
      const stopAllSpy = vi.spyOn(registry, "stopAll");

      await stopChannels(registry);

      expect(stopAllSpy).toHaveBeenCalled();
    });
  });
});
