// src/infra/store.ts
/**
 * Shared infrastructure store for rate limiting, idempotency, and event logging.
 * Used by both gateway-http and gateway (message channels).
 */

import Database from "better-sqlite3";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responseJson: string;
  expiresAt: number;
}

export interface EventRecord {
  id: number;
  type: string;
  time: number;
  status: string;
  source: string;
  message: string;
  metadataJson: string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  resetAt: number;
  remaining?: number;
}

export interface InfraStoreConfig {
  /** Path to SQLite database file */
  sqlitePath: string;
  /** TTL for idempotency records in ms (default: 5 minutes) */
  idempotencyTtlMs?: number;
  /** TTL for event records in ms (default: 24 hours) */
  eventTtlMs?: number;
}

export interface InfraStore {
  // Idempotency
  saveIdempotency(
    key: string,
    requestHash: string,
    response: unknown,
    expiresAt: number,
  ): void;
  getIdempotency(key: string): IdempotencyRecord | null;

  // Events
  insertEvent(event: Omit<EventRecord, "id"> & { expiresAt: number }): void;
  pollEvents(
    since: number | null,
    limit: number,
    now: number,
  ): { cursor: number; events: EventRecord[] };
  getRecentEvents(limit: number): EventRecord[];

  // Rate Limiting
  checkRateLimit(
    bucket: string,
    windowMs: number,
    max: number,
    now: number,
  ): RateLimitResult;

  // Stats
  getStats(): InfraStats;

  // Cleanup
  cleanup(now: number): void;

  // Close
  close(): void;
}

export interface InfraStats {
  eventCount: number;
  idempotencyCount: number;
  rateLimitBuckets: number;
  uptime: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Row Types
// ─────────────────────────────────────────────────────────────────────────────

interface IdempotencyRow {
  key: string;
  request_hash: string;
  response_json: string;
  expires_at: number;
}

interface EventRow {
  id: number;
  type: string;
  time: number;
  status: string;
  source: string;
  message: string;
  metadata_json: string | null;
}

interface RateLimitRow {
  count: number;
  reset_at: number;
}

interface CountRow {
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash a message for idempotency checking.
 * For message gateways: channel + messageId + body
 */
export function hashMessage(
  channel: string,
  messageId: string,
  body: string,
): string {
  return createHash("sha256")
    .update(`${channel}:${messageId}:${body}`)
    .digest("hex");
}

/**
 * Hash an HTTP request for idempotency checking.
 * For HTTP gateway: method + path + deviceId + body
 */
export function hashRequest(
  method: string,
  path: string,
  body: string,
  deviceId: string,
): string {
  return createHash("sha256")
    .update(`${method}:${path}:${deviceId}:${body}`)
    .digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Store Implementation
// ─────────────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function createInfraStore(config: InfraStoreConfig): InfraStore {
  const db = new Database(config.sqlitePath);
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS infra_idempotency (
      key TEXT PRIMARY KEY,
      request_hash TEXT,
      response_json TEXT,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS infra_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      time INTEGER,
      status TEXT,
      source TEXT,
      message TEXT,
      metadata_json TEXT,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS infra_rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER,
      reset_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_infra_events_time ON infra_events(time);
    CREATE INDEX IF NOT EXISTS idx_infra_events_expires ON infra_events(expires_at);
  `);

  return {
    saveIdempotency(key, requestHash, response, expiresAt) {
      db.prepare(
        "INSERT OR REPLACE INTO infra_idempotency(key, request_hash, response_json, expires_at) VALUES(?,?,?,?)",
      ).run(key, requestHash, JSON.stringify(response), expiresAt);
    },

    getIdempotency(key) {
      const row = db
        .prepare<[string], IdempotencyRow>(
          "SELECT key, request_hash, response_json, expires_at FROM infra_idempotency WHERE key=?",
        )
        .get(key);
      if (!row) return null;
      return {
        key: row.key,
        requestHash: row.request_hash,
        responseJson: row.response_json,
        expiresAt: row.expires_at,
      };
    },

    insertEvent(event) {
      db.prepare(
        "INSERT INTO infra_events(type, time, status, source, message, metadata_json, expires_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        event.type,
        event.time,
        event.status,
        event.source,
        event.message,
        event.metadataJson,
        event.expiresAt,
      );
    },

    pollEvents(since, limit, now) {
      const rows: EventRow[] = since
        ? db
            .prepare<[number, number, number], EventRow>(
              "SELECT id, type, time, status, source, message, metadata_json FROM infra_events WHERE id>? AND expires_at>? ORDER BY id ASC LIMIT ?",
            )
            .all(since, now, limit)
        : db
            .prepare<[number, number], EventRow>(
              "SELECT id, type, time, status, source, message, metadata_json FROM infra_events WHERE expires_at>? ORDER BY id DESC LIMIT ?",
            )
            .all(now, limit)
            .reverse();
      const cursor = rows.length ? rows[rows.length - 1].id : (since ?? 0);
      return { cursor, events: rows.map(mapEventRow) };
    },

    getRecentEvents(limit) {
      const rows = db
        .prepare<[number], EventRow>(
          "SELECT id, type, time, status, source, message, metadata_json FROM infra_events ORDER BY id DESC LIMIT ?",
        )
        .all(limit);
      return rows.map(mapEventRow);
    },

    checkRateLimit(bucket, windowMs, max, now) {
      const current = db
        .prepare<[string], RateLimitRow>(
          "SELECT count, reset_at FROM infra_rate_limits WHERE bucket=?",
        )
        .get(bucket);

      if (!current || current.reset_at <= now) {
        // Window expired or new bucket
        db.prepare(
          "INSERT OR REPLACE INTO infra_rate_limits(bucket, count, reset_at) VALUES(?,?,?)",
        ).run(bucket, 1, now + windowMs);
        return { allowed: true, resetAt: now + windowMs, remaining: max - 1 };
      }

      if (current.count >= max) {
        return {
          allowed: false,
          resetAt: current.reset_at,
          remaining: 0,
        };
      }

      db.prepare(
        "UPDATE infra_rate_limits SET count=count+1 WHERE bucket=?",
      ).run(bucket);
      return {
        allowed: true,
        resetAt: current.reset_at,
        remaining: max - current.count - 1,
      };
    },

    getStats() {
      const eventCount =
        db
          .prepare<[], CountRow>("SELECT COUNT(*) as count FROM infra_events")
          .get()?.count ?? 0;
      const idempotencyCount =
        db
          .prepare<[], CountRow>(
            "SELECT COUNT(*) as count FROM infra_idempotency",
          )
          .get()?.count ?? 0;
      const rateLimitBuckets =
        db
          .prepare<[], CountRow>(
            "SELECT COUNT(*) as count FROM infra_rate_limits",
          )
          .get()?.count ?? 0;

      return {
        eventCount,
        idempotencyCount,
        rateLimitBuckets,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
    },

    cleanup(now) {
      db.prepare("DELETE FROM infra_idempotency WHERE expires_at <= ?").run(
        now,
      );
      db.prepare("DELETE FROM infra_events WHERE expires_at <= ?").run(now);
      // Clean up expired rate limit buckets
      db.prepare("DELETE FROM infra_rate_limits WHERE reset_at <= ?").run(now);
    },

    close() {
      db.close();
    },
  };
}

function mapEventRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: row.type,
    time: row.time,
    status: row.status,
    source: row.source,
    message: row.message,
    metadataJson: row.metadata_json,
  };
}
