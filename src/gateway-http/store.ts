import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { hashToken } from "./utils.js";

export interface DeviceRecord {
  deviceId: string;
  tokenHash: string | null;
  revokedAt: number | null;
  pairedAt: number | null;
  lastSeenAt: number | null;
}

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

export interface Store {
  getDevice(deviceId: string): DeviceRecord | null;
  listDevices(): DeviceRecord[];
  touchDeviceSeen(deviceId: string, now: number): void;
  addPending(deviceId: string, ip: string, userAgent: string): void;
  listPending(): Array<{
    deviceId: string;
    requestedAt: number;
    ip: string;
    userAgent: string;
  }>;
  approveDevice(deviceId: string, token?: string): string;
  revokeDevice(deviceId: string): void;
  saveIdempotency(
    key: string,
    requestHash: string,
    response: unknown,
    expiresAt: number
  ): void;
  getIdempotency(key: string): IdempotencyRecord | null;
  insertEvent(event: Omit<EventRecord, "id"> & { expiresAt: number }): void;
  pollEvents(
    since: number | null,
    limit: number,
    now: number
  ): { cursor: number; events: EventRecord[] };
  insertAudit(row: Record<string, unknown>): void;
  checkRateLimit(
    bucket: string,
    windowMs: number,
    max: number,
    now: number
  ): { allowed: boolean; resetAt: number };
  cleanup(now: number): void;
}

interface DeviceRow {
  device_id: string;
  token_hash: string | null;
  revoked_at: number | null;
  paired_at: number | null;
  last_seen_at: number | null;
}

interface PendingRow {
  device_id: string;
  requested_at: number;
  ip: string;
  user_agent: string;
}

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

export function createStore(path: string): Store {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      token_hash TEXT,
      revoked_at INTEGER,
      paired_at INTEGER,
      last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS pairing_pending (
      device_id TEXT PRIMARY KEY,
      requested_at INTEGER,
      ip TEXT,
      user_agent TEXT
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      request_hash TEXT,
      response_json TEXT,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      time INTEGER,
      status TEXT,
      source TEXT,
      message TEXT,
      metadata_json TEXT,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER,
      actor_id TEXT,
      device_id TEXT,
      route TEXT,
      ip TEXT,
      request_id TEXT,
      trace_id TEXT,
      action TEXT,
      level TEXT,
      result TEXT,
      metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER,
      reset_at INTEGER
    );
  `);

  return {
    getDevice(deviceId) {
      const row = db
        .prepare<[string], DeviceRow>(
          "SELECT device_id, token_hash, revoked_at, paired_at, last_seen_at FROM devices WHERE device_id=?"
        )
        .get(deviceId);
      if (!row) return null;
      return {
        deviceId: row.device_id,
        tokenHash: row.token_hash,
        revokedAt: row.revoked_at,
        pairedAt: row.paired_at,
        lastSeenAt: row.last_seen_at,
      };
    },
    listDevices() {
      const rows = db
        .prepare<[], DeviceRow>(
          "SELECT device_id, token_hash, revoked_at, paired_at, last_seen_at FROM devices ORDER BY paired_at DESC"
        )
        .all();
      return rows.map((row) => ({
        deviceId: row.device_id,
        tokenHash: row.token_hash,
        revokedAt: row.revoked_at,
        pairedAt: row.paired_at,
        lastSeenAt: row.last_seen_at,
      }));
    },
    touchDeviceSeen(deviceId, now) {
      db.prepare("UPDATE devices SET last_seen_at=? WHERE device_id=?").run(now, deviceId);
    },
    addPending(deviceId, ip, userAgent) {
      db.prepare(
        "INSERT OR REPLACE INTO pairing_pending(device_id, requested_at, ip, user_agent) VALUES(?,?,?,?)"
      ).run(deviceId, Date.now(), ip, userAgent);
    },
    listPending() {
      return db
        .prepare<[], PendingRow>(
          "SELECT device_id, requested_at, ip, user_agent FROM pairing_pending"
        )
        .all()
        .map((row) => ({
          deviceId: row.device_id,
          requestedAt: row.requested_at,
          ip: row.ip,
          userAgent: row.user_agent,
        }));
    },
    approveDevice(deviceId, token) {
      const issued = token ?? cryptoRandomToken();
      const tokenHash = hashToken(issued);
      const now = Date.now();
      db.prepare(
        "INSERT OR REPLACE INTO devices(device_id, token_hash, revoked_at, paired_at, last_seen_at) VALUES(?,?,?,?,?)"
      ).run(deviceId, tokenHash, null, now, now);
      db.prepare("DELETE FROM pairing_pending WHERE device_id=?").run(deviceId);
      return issued;
    },
    revokeDevice(deviceId) {
      db.prepare("UPDATE devices SET revoked_at=? WHERE device_id=?").run(
        Date.now(),
        deviceId
      );
    },
    saveIdempotency(key, requestHash, response, expiresAt) {
      db.prepare(
        "INSERT OR REPLACE INTO idempotency(key, request_hash, response_json, expires_at) VALUES(?,?,?,?)"
      ).run(key, requestHash, JSON.stringify(response), expiresAt);
    },
    getIdempotency(key) {
      const row = db
        .prepare<[string], IdempotencyRow>(
          "SELECT key, request_hash, response_json, expires_at FROM idempotency WHERE key=?"
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
        "INSERT INTO events(type, time, status, source, message, metadata_json, expires_at) VALUES(?,?,?,?,?,?,?)"
      ).run(
        event.type,
        event.time,
        event.status,
        event.source,
        event.message,
        event.metadataJson,
        event.expiresAt
      );
    },
    pollEvents(since, limit, now) {
      const rows: EventRow[] = since
        ? db
            .prepare<[number, number, number], EventRow>(
              "SELECT id, type, time, status, source, message, metadata_json FROM events WHERE id>? AND expires_at>? ORDER BY id ASC LIMIT ?"
            )
            .all(since, now, limit)
        : db
            .prepare<[number, number], EventRow>(
              "SELECT id, type, time, status, source, message, metadata_json FROM events WHERE expires_at>? ORDER BY id DESC LIMIT ?"
            )
            .all(now, limit)
            .reverse();
      const cursor = rows.length ? rows[rows.length - 1].id : since ?? 0;
      return { cursor, events: rows.map(mapEventRow) };
    },
    insertAudit(row) {
      db.prepare(
        "INSERT INTO audit_logs(time, actor_id, device_id, route, ip, request_id, trace_id, action, level, result, metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        row.time ?? Date.now(),
        row.actor_id ?? null,
        row.device_id ?? null,
        row.route ?? "",
        row.ip ?? "",
        row.request_id ?? null,
        row.trace_id ?? null,
        row.action ?? "",
        row.level ?? "",
        row.result ?? "",
        row.metadata_json ?? null
      );
    },
    checkRateLimit(bucket, windowMs, max, now) {
      const current = db
        .prepare<[string], RateLimitRow>("SELECT count, reset_at FROM rate_limits WHERE bucket=?")
        .get(bucket);
      if (!current || current.reset_at <= now) {
        db.prepare(
          "INSERT OR REPLACE INTO rate_limits(bucket, count, reset_at) VALUES(?,?,?)"
        ).run(bucket, 1, now + windowMs);
        return { allowed: true, resetAt: now + windowMs };
      }
      if (current.count >= max) {
        return { allowed: false, resetAt: current.reset_at };
      }
      db.prepare("UPDATE rate_limits SET count=count+1 WHERE bucket=?").run(
        bucket
      );
      return { allowed: true, resetAt: current.reset_at };
    },
    cleanup(now) {
      db.prepare("DELETE FROM idempotency WHERE expires_at <= ?").run(now);
      db.prepare("DELETE FROM events WHERE expires_at <= ?").run(now);
    },
  };
}

function cryptoRandomToken() {
  return randomBytes(24).toString("hex");
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
