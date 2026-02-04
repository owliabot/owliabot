/**
 * WriteGateChannel adapter + reply router middleware
 *
 * The ChannelPlugin.onMessage only accepts a single handler, so we intercept
 * confirmation replies in the gateway server before the main handler runs.
 */

import { createLogger } from "../utils/logger.js";
import type { ChannelPlugin, MsgContext } from "../channels/interface.js";
import type { WriteGateChannel } from "./write-gate.js";

const log = createLogger("write-gate-adapter");

// ── Reply Router (middleware) ──────────────────────────────────────────────

interface PendingWaiter {
  resolve: (reply: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Routes incoming messages to pending WriteGate confirmation waiters.
 * Install as middleware: call `tryRoute(ctx)` before the main message handler.
 */
export class WriteGateReplyRouter {
  private readonly waiters = new Map<string, PendingWaiter>();

  private static waiterKey(channel: string, target: string, userId: string): string {
    return `${channel}:${target}:${userId}`;
  }

  /**
   * Check if an incoming message is a reply to a pending confirmation.
   * Returns true if consumed (caller should skip normal handling).
   */
  tryRoute(ctx: MsgContext): boolean {
    const conversationId =
      ctx.chatType === "direct" ? ctx.from : ctx.groupId ?? ctx.from;
    const key = WriteGateReplyRouter.waiterKey(ctx.channel, conversationId, ctx.from);
    const waiter = this.waiters.get(key);
    if (!waiter) return false;

    log.debug(`Confirmation reply from ${ctx.from}: "${ctx.body}"`);
    clearTimeout(waiter.timer);
    this.waiters.delete(key);
    waiter.resolve(ctx.body);
    return true;
  }

  /**
   * Wait for a text reply from a specific user in the target channel.
   * Returns the reply body or null on timeout.
   */
  waitForReply(
    channelId: string,
    target: string,
    fromUserId: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const key = WriteGateReplyRouter.waiterKey(channelId, target, fromUserId);

    // If there's already a waiter for this key, resolve it as null (superseded)
    const existing = this.waiters.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve(""); // will be treated as denial
      this.waiters.delete(key);
    }

    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        resolve(null);
      }, timeoutMs);

      this.waiters.set(key, {
        resolve: (reply: string) => resolve(reply),
        timer,
      });
    });
  }
}

// ── Channel Adapter ────────────────────────────────────────────────────────

/**
 * Create a WriteGateChannel backed by a ChannelPlugin + reply router.
 */
export function createWriteGateChannelAdapter(
  plugin: ChannelPlugin,
  replyRouter: WriteGateReplyRouter,
): WriteGateChannel {
  return {
    async sendMessage(target, msg) {
      await plugin.send(target, msg);
    },

    async waitForReply(target, fromUserId, timeoutMs) {
      // Curry the channel ID to prevent cross-channel waiter collisions
      return replyRouter.waitForReply(plugin.id, target, fromUserId, timeoutMs);
    },
  };
}
