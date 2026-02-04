import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WriteGateReplyRouter,
  createWriteGateChannelAdapter,
} from "../write-gate-adapter.js";
import type { ChannelPlugin, MsgContext } from "../../channels/interface.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("write-gate-adapter", () => {
  describe("WriteGateReplyRouter", () => {
    let router: WriteGateReplyRouter;

    beforeEach(() => {
      router = new WriteGateReplyRouter();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("hasPendingWaiter", () => {
      it("should return false when no waiter exists", () => {
        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "yes",
          messageId: "msg1",
          channel: "discord",
          chatType: "direct",
          timestamp: Date.now(),
        };

        expect(router.hasPendingWaiter(ctx)).toBe(false);
      });

      it("should return true when waiter exists", async () => {
        const waitPromise = router.waitForReply("discord", "user1", "user1", 5000);

        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "yes",
          messageId: "msg1",
          channel: "discord",
          chatType: "direct",
          timestamp: Date.now(),
        };

        expect(router.hasPendingWaiter(ctx)).toBe(true);

        // Clean up
        router.tryRoute(ctx);
        await waitPromise;
      });
    });

    describe("tryRoute", () => {
      it("should return false when no waiter exists", () => {
        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "yes",
          messageId: "msg1",
          channel: "discord",
          chatType: "direct",
          timestamp: Date.now(),
        };

        expect(router.tryRoute(ctx)).toBe(false);
      });

      it("should route reply to waiting waiter", async () => {
        const waitPromise = router.waitForReply("discord", "user1", "user1", 5000);

        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "yes",
          messageId: "msg1",
          channel: "discord",
          chatType: "direct",
          timestamp: Date.now(),
        };

        expect(router.tryRoute(ctx)).toBe(true);

        const reply = await waitPromise;
        expect(reply).toBe("yes");
      });

      it("should handle group chat context", async () => {
        const waitPromise = router.waitForReply("discord", "group123", "user1", 5000);

        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "no",
          messageId: "msg1",
          channel: "discord",
          chatType: "group",
          groupId: "group123",
          timestamp: Date.now(),
        };

        expect(router.tryRoute(ctx)).toBe(true);

        const reply = await waitPromise;
        expect(reply).toBe("no");
      });
    });

    describe("waitForReply", () => {
      it("should resolve with reply text when received", async () => {
        const waitPromise = router.waitForReply("discord", "user1", "user1", 5000);

        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "confirmed",
          messageId: "msg1",
          channel: "discord",
          chatType: "direct",
          timestamp: Date.now(),
        };

        router.tryRoute(ctx);

        const reply = await waitPromise;
        expect(reply).toBe("confirmed");
      });

      it("should resolve with null on timeout", async () => {
        const waitPromise = router.waitForReply("discord", "user1", "user1", 1000);

        vi.advanceTimersByTime(1000);

        const reply = await waitPromise;
        expect(reply).toBeNull();
      });

      it("should supersede existing waiter for same key", async () => {
        const waitPromise1 = router.waitForReply("discord", "user1", "user1", 5000);
        const waitPromise2 = router.waitForReply("discord", "user1", "user1", 5000);

        // First promise should resolve immediately with empty string
        const reply1 = await waitPromise1;
        expect(reply1).toBe("");

        // Second promise should still be waiting
        const ctx: MsgContext = {
          from: "user1",
          senderName: "Alice",
          body: "yes",
          messageId: "msg1",
          channel: "discord",
          chatType: "direct",
          timestamp: Date.now(),
        };

        router.tryRoute(ctx);

        const reply2 = await waitPromise2;
        expect(reply2).toBe("yes");
      });
    });
  });

  describe("createWriteGateChannelAdapter", () => {
    it("should create adapter with sendMessage method", async () => {
      const mockPlugin: ChannelPlugin = {
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

      const router = new WriteGateReplyRouter();
      const adapter = createWriteGateChannelAdapter(mockPlugin, router);

      await adapter.sendMessage("user1", { text: "Confirm action?" });

      expect(mockPlugin.send).toHaveBeenCalledWith("user1", {
        text: "Confirm action?",
      });
    });

    it("should create adapter with waitForReply method", async () => {
      const mockPlugin: ChannelPlugin = {
        id: "telegram",
        start: vi.fn(),
        stop: vi.fn(),
        onMessage: vi.fn(),
        send: vi.fn(async () => {}),
        capabilities: {
          reactions: false,
          threads: false,
          buttons: true,
          markdown: true,
          maxMessageLength: 4096,
        },
      };

      const router = new WriteGateReplyRouter();
      const adapter = createWriteGateChannelAdapter(mockPlugin, router);

      vi.useFakeTimers();

      const waitPromise = adapter.waitForReply("user1", "user1", 1000);

      vi.advanceTimersByTime(1000);

      const reply = await waitPromise;
      expect(reply).toBeNull();

      vi.useRealTimers();
    });
  });
});
