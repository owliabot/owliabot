import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelRegistry } from "../registry.js";
import type { ChannelPlugin } from "../interface.js";

describe("ChannelRegistry", () => {
  let registry: ChannelRegistry;

  const createMockPlugin = (id: "discord" | "telegram"): ChannelPlugin => ({
    id,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onMessage: vi.fn(),
    send: vi.fn(async () => {}),
    capabilities: {
      reactions: true,
      threads: true,
      buttons: true,
      markdown: true,
      maxMessageLength: 2000,
    },
  });

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  describe("register", () => {
    it("should register a plugin", () => {
      const plugin = createMockPlugin("discord");
      registry.register(plugin);

      const retrieved = registry.get("discord");
      expect(retrieved).toBe(plugin);
    });

    it("should overwrite existing plugin with same id", () => {
      const plugin1 = createMockPlugin("discord");
      const plugin2 = createMockPlugin("discord");

      registry.register(plugin1);
      registry.register(plugin2);

      const retrieved = registry.get("discord");
      expect(retrieved).toBe(plugin2);
    });
  });

  describe("get", () => {
    it("should return plugin by id", () => {
      const plugin = createMockPlugin("telegram");
      registry.register(plugin);

      const retrieved = registry.get("telegram");
      expect(retrieved).toBe(plugin);
    });

    it("should return undefined for non-existent plugin", () => {
      const retrieved = registry.get("discord");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all registered plugins", () => {
      const discord = createMockPlugin("discord");
      const telegram = createMockPlugin("telegram");

      registry.register(discord);
      registry.register(telegram);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(discord);
      expect(all).toContain(telegram);
    });

    it("should return empty array when no plugins registered", () => {
      const all = registry.getAll();
      expect(all).toEqual([]);
    });
  });

  describe("startAll", () => {
    it("should start all registered plugins", async () => {
      const discord = createMockPlugin("discord");
      const telegram = createMockPlugin("telegram");

      registry.register(discord);
      registry.register(telegram);

      await registry.startAll();

      expect(discord.start).toHaveBeenCalled();
      expect(telegram.start).toHaveBeenCalled();
    });

    it("should handle empty registry", async () => {
      await expect(registry.startAll()).resolves.toBeUndefined();
    });
  });

  describe("stopAll", () => {
    it("should stop all registered plugins", async () => {
      const discord = createMockPlugin("discord");
      const telegram = createMockPlugin("telegram");

      registry.register(discord);
      registry.register(telegram);

      await registry.stopAll();

      expect(discord.stop).toHaveBeenCalled();
      expect(telegram.stop).toHaveBeenCalled();
    });

    it("should handle empty registry", async () => {
      await expect(registry.stopAll()).resolves.toBeUndefined();
    });
  });
});
