/**
 * Rate-limited notification for unbound (non-allowlisted) users.
 *
 * When a user who isn't on the allowlist messages the bot, we send a
 * short onboard prompt instead of silently ignoring them.  To avoid
 * spamming, each user is notified at most once per cooldown window.
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("unbound-notify");

const DEFAULT_MESSAGE =
  "⚠️ 你还没有绑定。请先完成 onboard 流程，或联系管理员。\n" +
  "⚠️ You're not bound yet. Please contact an admin to get started.";

/** Default cooldown: 1 hour */
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;

export interface UnboundNotifierOptions {
  /** Custom reply message. Falls back to a bilingual default. */
  message?: string;
  /** Minimum interval between notifications per user (ms). Default 1 h. */
  cooldownMs?: number;
}

export class UnboundNotifier {
  private readonly message: string;
  private readonly cooldownMs: number;
  /** userId → last notification timestamp */
  private readonly lastNotified = new Map<string, number>();

  constructor(opts?: UnboundNotifierOptions) {
    this.message = opts?.message?.trim() || DEFAULT_MESSAGE;
    this.cooldownMs = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /**
   * Returns the reply text if the user should be notified, or `null` if
   * they were notified recently and should be silently ignored.
   */
  shouldNotify(userId: string, now = Date.now()): string | null {
    const last = this.lastNotified.get(userId);
    if (last !== undefined && now - last < this.cooldownMs) {
      log.debug(`Suppressing unbound notification for ${userId} (cooldown)`);
      return null;
    }
    this.lastNotified.set(userId, now);
    return this.message;
  }

  /** Visible for testing */
  _getLastNotified(userId: string): number | undefined {
    return this.lastNotified.get(userId);
  }
}
