import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNotificationService } from "../service.js";
import { ChannelRegistry } from "../../channels/registry.js";
import type { ChannelPlugin } from "../../channels/interface.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("notification service", () => {
  let registry: ChannelRegistry;
  let mockPlugin: ChannelPlugin;

  beforeEach(() => {
    registry = new ChannelRegistry();
    mockPlugin = {
      id: "discord",
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      send: vi.fn(async () => {}),
      capabilities: {
        reactions: true,
        threads: true,
        buttons: true,
        markdown: true,
        maxMessageLength: 2000,
      },
    };
    registry.register(mockPlugin);
  });

  describe("notify", () => {
    it("should send to default channel when configured", async () => {
      const service = createNotificationService({
        defaultChannel: "discord:123456",
        channels: registry,
      });

      await service.notify("Test notification");

      expect(mockPlugin.send).toHaveBeenCalledWith("123456", {
        text: "Test notification",
      });
    });

    it("should handle missing default channel", async () => {
      const service = createNotificationService({
        channels: registry,
      });

      // Should not throw
      await service.notify("Test notification");

      expect(mockPlugin.send).not.toHaveBeenCalled();
    });
  });

  describe("notifyChannel", () => {
    it("should send notification to specific channel", async () => {
      const service = createNotificationService({
        channels: registry,
      });

      await service.notifyChannel("discord:789012", "Direct message");

      expect(mockPlugin.send).toHaveBeenCalledWith("789012", {
        text: "Direct message",
      });
    });

    it("should handle invalid target format", async () => {
      const service = createNotificationService({
        channels: registry,
      });

      // Should not throw
      await service.notifyChannel("invalid-target", "Message");

      expect(mockPlugin.send).not.toHaveBeenCalled();
    });

    it("should handle unknown channel", async () => {
      const service = createNotificationService({
        channels: registry,
      });

      // Should not throw
      await service.notifyChannel("telegram:123456", "Message");

      expect(mockPlugin.send).not.toHaveBeenCalled();
    });

    it("should handle send errors", async () => {
      mockPlugin.send = vi.fn(async () => {
        throw new Error("Send failed");
      });

      const service = createNotificationService({
        channels: registry,
      });

      // Should not throw
      await service.notifyChannel("discord:123456", "Message");
    });
  });

  describe("notify options", () => {
    it("should accept priority option", async () => {
      const service = createNotificationService({
        defaultChannel: "discord:123456",
        channels: registry,
      });

      await service.notify("High priority", { priority: "high" });

      expect(mockPlugin.send).toHaveBeenCalled();
    });

    it("should accept silent option", async () => {
      const service = createNotificationService({
        defaultChannel: "discord:123456",
        channels: registry,
      });

      await service.notify("Silent message", { silent: true });

      expect(mockPlugin.send).toHaveBeenCalled();
    });
  });
});
