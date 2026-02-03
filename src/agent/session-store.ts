/**
 * SessionStore
 *
 * Maps a stable sessionKey -> sessionId (UUID) and stores minimal metadata.
 *
 * - Store file: <sessionsDir>/sessions.json
 * - Concurrency: lockfile + atomic write
 */

import { mkdir, readFile, rename, unlink, writeFile, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger.js";

const log = createLogger("session-store");

export type SessionKey = string;
export type SessionId = string;

export interface SessionEntry {
  sessionId: SessionId;
  updatedAt: number;
  // Optional metadata (v1 doesn't require)
  channel?: string;
  chatType?: string;
  groupId?: string;
  displayName?: string;
}

export interface SessionStoreOptions {
  sessionsDir: string;
  /** Optional override for store path */
  storePath?: string;
  /** lock acquisition timeout */
  lockTimeoutMs?: number;
  /** polling interval while waiting for lock */
  lockRetryMs?: number;
}

export interface SessionStore {
  getOrCreate(sessionKey: SessionKey, meta?: Partial<SessionEntry>): Promise<SessionEntry>;
  /** Rotate to a new sessionId for this key ("clear" semantics). */
  rotate(sessionKey: SessionKey, meta?: Partial<SessionEntry>): Promise<SessionEntry>;
  /** List all known session keys. */
  listKeys(): Promise<SessionKey[]>;
  /** Fetch entry if exists. */
  get(sessionKey: SessionKey): Promise<SessionEntry | null>;
}

type StoreFile = Record<SessionKey, SessionEntry>;

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const storePath = options.storePath ?? join(options.sessionsDir, "sessions.json");
  const lockPath = storePath + ".lock";
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  const lockRetryMs = options.lockRetryMs ?? 100;

  async function sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async function ensureDir() {
    await mkdir(dirname(storePath), { recursive: true });
  }

  async function readStore(): Promise<StoreFile> {
    try {
      const raw = await readFile(storePath, "utf-8");
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw) as StoreFile;
      // Basic sanity check
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return {};
      log.warn(`Failed to read store (${storePath}), will recreate`, err);
      return {};
    }
  }

  async function writeStoreAtomic(data: StoreFile): Promise<void> {
    await ensureDir();
    const tmpPath = storePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, storePath);
  }

  async function breakStaleLockIfNeeded(now: number): Promise<void> {
    try {
      const raw = await readFile(lockPath, "utf-8");
      const parsed = JSON.parse(raw) as { pid?: number; createdAt?: number };
      const createdAt = typeof parsed?.createdAt === "number" ? parsed.createdAt : 0;
      if (createdAt && now - createdAt > lockTimeoutMs) {
        log.warn(`Stale session store lock detected; breaking lock (age=${now - createdAt}ms)`);
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      // If lock is corrupted, break it.
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const start = Date.now();

    while (true) {
      const now = Date.now();
      if (now - start > lockTimeoutMs) {
        // Final attempt: break stale lock and try once more.
        await breakStaleLockIfNeeded(now);
      }

      try {
        // Acquire lock (exclusive create)
        const fh = await open(lockPath, "wx");
        try {
          await fh.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
            "utf-8"
          );
        } finally {
          await fh.close();
        }

        try {
          return await fn();
        } finally {
          await unlink(lockPath).catch(() => undefined);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw err;

        // Wait, and if it's stale, break it.
        await breakStaleLockIfNeeded(Date.now());
        await sleep(lockRetryMs);
      }
    }
  }

  async function upsert(
    sessionKey: SessionKey,
    sessionId: SessionId,
    meta?: Partial<SessionEntry>
  ): Promise<SessionEntry> {
    return withLock(async () => {
      const store = await readStore();
      const next: SessionEntry = {
        sessionId,
        updatedAt: Date.now(),
        ...meta,
      };
      store[sessionKey] = next;
      await writeStoreAtomic(store);
      return next;
    });
  }

  return {
    async get(sessionKey: SessionKey): Promise<SessionEntry | null> {
      const store = await readStore();
      return store[sessionKey] ?? null;
    },

    async getOrCreate(sessionKey: SessionKey, meta?: Partial<SessionEntry>): Promise<SessionEntry> {
      const existing = await this.get(sessionKey);
      if (existing) {
        // Touch updatedAt (best effort) but keep same sessionId.
        return upsert(sessionKey, existing.sessionId, { ...existing, ...meta, updatedAt: Date.now() });
      }
      return upsert(sessionKey, randomUUID(), meta);
    },

    async rotate(sessionKey: SessionKey, meta?: Partial<SessionEntry>): Promise<SessionEntry> {
      return upsert(sessionKey, randomUUID(), meta);
    },

    async listKeys(): Promise<SessionKey[]> {
      const store = await readStore();
      return Object.keys(store);
    },
  };
}
