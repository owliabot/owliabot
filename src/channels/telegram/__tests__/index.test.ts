import { describe, it, expect, vi } from "vitest";
import { createTelegramPlugin } from "../index.js";

vi.mock("grammy", () => {
  class MockBot {
    start = vi.fn();
    stop = vi.fn();
    on = vi.fn();
    api = {
      sendMessage: vi.fn(),
    };
  }

  return {
    Bot: MockBot,
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

describe("telegram plugin", () => {
  it("should create telegram plugin with required config", () => {
    const plugin = createTelegramPlugin({
      token: "test-token",
    });

    expect(plugin).toBeDefined();
    expect(plugin.id).toBe("telegram");
    expect(plugin.capabilities).toBeDefined();
  });

  it("should have correct capabilities", () => {
    const plugin = createTelegramPlugin({ token: "test-token" });

    expect(plugin.capabilities.reactions).toBe(true);
    expect(plugin.capabilities.threads).toBe(false);
    expect(plugin.capabilities.buttons).toBe(true);
    expect(plugin.capabilities.markdown).toBe(true);
    expect(plugin.capabilities.maxMessageLength).toBe(4096);
  });

  it("should support user allow list", () => {
    const plugin = createTelegramPlugin({
      token: "test-token",
      userAllowList: ["user1", "user2"],
    });

    expect(plugin).toBeDefined();
  });

  it("should support group allow list", () => {
    const plugin = createTelegramPlugin({
      token: "test-token",
      groupAllowList: ["group1", "group2"],
    });

    expect(plugin).toBeDefined();
  });

  it("should support requireMentionInGroup option", () => {
    const plugin = createTelegramPlugin({
      token: "test-token",
      requireMentionInGroup: true,
    });

    expect(plugin).toBeDefined();
  });

  it("should support preFilter option", () => {
    const preFilter = vi.fn(() => true);
    const plugin = createTelegramPlugin({
      token: "test-token",
      preFilter,
    });

    expect(plugin).toBeDefined();
  });

  it("should have start method", () => {
    const plugin = createTelegramPlugin({ token: "test-token" });

    expect(typeof plugin.start).toBe("function");
  });

  it("should have stop method", () => {
    const plugin = createTelegramPlugin({ token: "test-token" });

    expect(typeof plugin.stop).toBe("function");
  });

  it("should have send method", () => {
    const plugin = createTelegramPlugin({ token: "test-token" });

    expect(typeof plugin.send).toBe("function");
  });

  it("should have onMessage method", () => {
    const plugin = createTelegramPlugin({ token: "test-token" });

    expect(typeof plugin.onMessage).toBe("function");
  });
});
