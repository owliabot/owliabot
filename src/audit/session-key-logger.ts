/**
 * Session Key lifecycle logger
 * @see docs/design/audit-strategy.md Section 5
 */

import { appendFile, readFile } from "node:fs/promises";
import { ulid } from "ulid";
import { createLogger } from "../utils/logger.js";

const log = createLogger("session-key-logger");

export type SessionKeyEventType =
  | "created"
  | "activated"
  | "used"
  | "rotated"
  | "revoked"
  | "expired"
  | "limit-reached";

export interface SessionKeyEvent {
  id: string;
  ts: string;
  event: SessionKeyEventType;
  sessionKeyId: string;
  publicKey?: string;
  chainId?: number;
  permissions?: {
    maxBalance: string;
    allowedContracts: string[];
    dailyLimit: string;
    expiresAt: string;
    ttlHours: number;
  };
  toolName?: string;
  amountUsd?: number;
  txHash?: string;
  auditLogId?: string;
  reason?: string;
  triggeredBy: string;
  approvedVia?: string;
  stats?: {
    totalUses: number;
    dailySpentUsd: number;
    remainingDailyUsd: number;
    balance: string;
  };
  lifetime?: {
    createdAt: string;
    revokedAt: string;
    durationHours: number;
    totalUses: number;
    totalSpentUsd: number;
  };
}

export class SessionKeyLogger {
  private logPath: string;

  constructor(logPath = "workspace/session-keys.jsonl") {
    this.logPath = logPath;
  }

  async log(event: Omit<SessionKeyEvent, "id" | "ts">): Promise<void> {
    const entry: SessionKeyEvent = {
      id: ulid(),
      ts: new Date().toISOString(),
      ...event,
    };

    try {
      await appendFile(this.logPath, JSON.stringify(entry) + "\n", "utf-8");
      log.info(`Session key event logged: ${event.event}`, {
        sessionKeyId: event.sessionKeyId,
      });
    } catch (err) {
      log.error("Failed to write session key log", err);
      // Also fail-closed for session key events
      throw new Error(
        `Session key logging failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getActiveKeys(): Promise<SessionKeyEvent[]> {
    try {
      const events = await this.readAll();
      const keyStates = new Map<string, SessionKeyEventType>();

      // Build state machine
      for (const e of events) {
        keyStates.set(e.sessionKeyId, e.event);
      }

      // Find keys that are not revoked or expired
      const activeKeyIds = [...keyStates.entries()]
        .filter(([_, state]) => !["revoked", "expired"].includes(state))
        .map(([id]) => id);

      // Return the creation events for active keys
      return events.filter(
        (e) => activeKeyIds.includes(e.sessionKeyId) && e.event === "created"
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async getKeyHistory(sessionKeyId: string): Promise<SessionKeyEvent[]> {
    const events = await this.readAll();
    return events.filter((e) => e.sessionKeyId === sessionKeyId);
  }

  private async readAll(): Promise<SessionKeyEvent[]> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as SessionKeyEvent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
