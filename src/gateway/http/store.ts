import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { hashToken } from "./utils.js";
import { parseScope, serializeScope, DEFAULT_SCOPE, type DeviceScope } from "./scope.js";

export interface DeviceRecord {
  deviceId: string;
  tokenHash: string | null;
  scope: DeviceScope;
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
  ackedAt: number | null;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  scope: DeviceScope;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
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
  removePending(deviceId: string): void;
  approveDevice(deviceId: string, scope?: DeviceScope, token?: string): string;
  revokeDevice(deviceId: string): void;
  updateScope(deviceId: string, scope: DeviceScope): boolean;
  rotateToken(deviceId: string): string | null;
  saveIdempotency(
    key: string,
    requestHash: string,
    response: unknown,
    expiresAt: number
  ): void;
  getIdempotency(key: string): IdempotencyRecord | null;
  insertEvent(event: Omit<EventRecord, "id" | "ackedAt"> & { expiresAt: number }): number;
  pollEvents(
    since: number | null,
    limit: number,
    now: number
  ): { cursor: number; events: EventRecord[] };
  pollEventsForDevice(
    deviceId: string,
    since: number | null,
    limit: number,
    now: number
  ): { cursor: number; events: EventRecord[]; dropped: number };
  ackEvents(deviceId: string, upToId: number, now: number): void;
  insertAudit(row: Record<string, unknown>): void;
  checkRateLimit(
    bucket: string,
    windowMs: number,
    max: number,
    now: number
  ): { allowed: boolean; resetAt: number };
  cleanup(now: number): void;
  createApiKey(name: string, scope: DeviceScope, expiresAt?: number): { id: string; key: string };
  getApiKeyByHash(keyHash: string): ApiKeyRecord | null;
  listApiKeys(): ApiKeyRecord[];
  revokeApiKey(id: string): boolean;
  touchApiKeyUsed(id: string, now: number): void;
}

interface DeviceRow {
  device_id: string;
  token_hash: string | null;
  scope_json: string | null;
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
  acked_at: number | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  scope_json: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
}

interface RateLimitRow {
  count: number;
  reset_at: number;
}

export function createStore(path: string): Store {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  // Create tables with Phase 2 schema (scope + acked_at)
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      token_hash TEXT,
      scope_json TEXT DEFAULT '{"tools":"read","system":false,"mcp":false}',
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
      expires_at INTEGER,
      acked_at INTEGER,
      target_device_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_target_device ON events(target_device_id, id);
    CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);
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
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      last_used_at INTEGER
    );
  `);

  // Migration: add scope_json column if missing (upgrading from Phase 1)
  try {
    db.exec(`ALTER TABLE devices ADD COLUMN scope_json TEXT DEFAULT '{"tools":"read","system":false,"mcp":false}'`);
  } catch {
    // Column already exists
  }

  // Migration: add acked_at and target_device_id columns if missing
  try {
    db.exec(`ALTER TABLE events ADD COLUMN acked_at INTEGER`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE events ADD COLUMN target_device_id TEXT`);
  } catch {
    // Column already exists
  }

  return {
    getDevice(deviceId) {
      const row = db
        .prepare<[string], DeviceRow>(
          "SELECT device_id, token_hash, scope_json, revoked_at, paired_at, last_seen_at FROM devices WHERE device_id=?"
        )
        .get(deviceId);
      if (!row) return null;
      return {
        deviceId: row.device_id,
        tokenHash: row.token_hash,
        scope: parseScope(row.scope_json),
        revokedAt: row.revoked_at,
        pairedAt: row.paired_at,
        lastSeenAt: row.last_seen_at,
      };
    },
    listDevices() {
      const rows = db
        .prepare<[], DeviceRow>(
          "SELECT device_id, token_hash, scope_json, revoked_at, paired_at, last_seen_at FROM devices ORDER BY paired_at DESC"
        )
        .all();
      return rows.map((row) => ({
        deviceId: row.device_id,
        tokenHash: row.token_hash,
        scope: parseScope(row.scope_json),
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
    removePending(deviceId) {
      db.prepare("DELETE FROM pairing_pending WHERE device_id=?").run(deviceId);
    },
    approveDevice(deviceId, scope, token) {
      const issued = token ?? cryptoRandomToken();
      const tokenHash = hashToken(issued);
      const now = Date.now();
      const deviceScope = scope ?? DEFAULT_SCOPE;
      const scopeJson = serializeScope(deviceScope);
      db.prepare(
        "INSERT OR REPLACE INTO devices(device_id, token_hash, scope_json, revoked_at, paired_at, last_seen_at) VALUES(?,?,?,?,?,?)"
      ).run(deviceId, tokenHash, scopeJson, null, now, now);
      db.prepare("DELETE FROM pairing_pending WHERE device_id=?").run(deviceId);
      return issued;
    },
    revokeDevice(deviceId) {
      db.prepare("UPDATE devices SET revoked_at=? WHERE device_id=?").run(
        Date.now(),
        deviceId
      );
    },
    updateScope(deviceId, scope) {
      const scopeJson = serializeScope(scope);
      const result = db.prepare(
        "UPDATE devices SET scope_json=? WHERE device_id=? AND revoked_at IS NULL"
      ).run(scopeJson, deviceId);
      return result.changes > 0;
    },
    rotateToken(deviceId) {
      const device = this.getDevice(deviceId);
      if (!device || device.revokedAt) return null;

      const newToken = cryptoRandomToken();
      const tokenHash = hashToken(newToken);
      db.prepare("UPDATE devices SET token_hash=? WHERE device_id=?").run(tokenHash, deviceId);
      return newToken;
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
      // Extract target device ID from metadata if present
      let targetDeviceId: string | null = null;
      if (event.metadataJson) {
        try {
          const meta = JSON.parse(event.metadataJson);
          targetDeviceId = meta.targetDeviceId ?? null;
        } catch {
          // Ignore parse errors
        }
      }

      const result = db.prepare(
        "INSERT INTO events(type, time, status, source, message, metadata_json, expires_at, target_device_id) VALUES(?,?,?,?,?,?,?,?)"
      ).run(
        event.type,
        event.time,
        event.status,
        event.source,
        event.message,
        event.metadataJson,
        event.expiresAt,
        targetDeviceId
      );
      return Number(result.lastInsertRowid);
    },
    pollEvents(since, limit, now) {
      const rows: EventRow[] = since
        ? db
            .prepare<[number, number, number], EventRow>(
              "SELECT id, type, time, status, source, message, metadata_json, acked_at FROM events WHERE id>? AND expires_at>? ORDER BY id ASC LIMIT ?"
            )
            .all(since, now, limit)
        : db
            .prepare<[number, number], EventRow>(
              "SELECT id, type, time, status, source, message, metadata_json, acked_at FROM events WHERE expires_at>? ORDER BY id DESC LIMIT ?"
            )
            .all(now, limit)
            .reverse();
      const cursor = rows.length ? rows[rows.length - 1].id : since ?? 0;
      return { cursor, events: rows.map(mapEventRow) };
    },
    pollEventsForDevice(deviceId, since, limit, now) {
      // TODO: `dropped` is always 0 — implement actual backlog tracking or remove the field
      let dropped = 0;

      // Query events for this device that are not yet acked
      const rows: EventRow[] = since
        ? db
            .prepare<[string, number, number, number], EventRow>(
              `SELECT id, type, time, status, source, message, metadata_json, acked_at
               FROM events
               WHERE target_device_id=? AND id>? AND expires_at>? AND acked_at IS NULL
               ORDER BY id ASC LIMIT ?`
            )
            .all(deviceId, since, now, limit)
        : db
            .prepare<[string, number, number], EventRow>(
              `SELECT id, type, time, status, source, message, metadata_json, acked_at
               FROM events
               WHERE target_device_id=? AND expires_at>? AND acked_at IS NULL
               ORDER BY id DESC LIMIT ?`
            )
            .all(deviceId, now, limit)
            .reverse();

      const cursor = rows.length ? rows[rows.length - 1].id : since ?? 0;
      return { cursor, events: rows.map(mapEventRow), dropped };
    },
    ackEvents(deviceId, upToId, now) {
      db.prepare(
        `UPDATE events SET acked_at=? WHERE target_device_id=? AND id<=? AND acked_at IS NULL`
      ).run(now, deviceId, upToId);
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
    createApiKey(name, scope, expiresAt) {
      const id = `ak_${randomBytes(8).toString("hex")}`;
      const key = `owk_${randomBytes(16).toString("hex")}`;
      const keyHash = hashToken(key);
      const scopeJson = serializeScope(scope);
      const now = Date.now();
      db.prepare(
        "INSERT INTO api_keys(id, name, key_hash, scope_json, created_at, expires_at) VALUES(?,?,?,?,?,?)"
      ).run(id, name, keyHash, scopeJson, now, expiresAt ?? null);
      return { id, key };
    },
    getApiKeyByHash(keyHash) {
      const row = db
        .prepare<[string], ApiKeyRow>(
          "SELECT id, name, key_hash, scope_json, created_at, expires_at, revoked_at, last_used_at FROM api_keys WHERE key_hash=?"
        )
        .get(keyHash);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        scope: parseScope(row.scope_json),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        lastUsedAt: row.last_used_at,
      };
    },
    listApiKeys() {
      const rows = db
        .prepare<[], ApiKeyRow>(
          "SELECT id, name, key_hash, scope_json, created_at, expires_at, revoked_at, last_used_at FROM api_keys ORDER BY created_at DESC"
        )
        .all();
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        scope: parseScope(row.scope_json),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        lastUsedAt: row.last_used_at,
      }));
    },
    revokeApiKey(id) {
      const result = db.prepare(
        "UPDATE api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL"
      ).run(Date.now(), id);
      return result.changes > 0;
    },
    touchApiKeyUsed(id, now) {
      db.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?").run(now, id);
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
    ackedAt: row.acked_at,
  };
}
