import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { Config } from "../../config/schema.js";
import { resolveAgentId } from "../../agent/session-key.js";
import { resolveMemorySearchConfig, resolveMemoryStorePath } from "../config.js";
import { MEMORY_INDEX_SCHEMA_VERSION } from "./schema.js";

function ensureDbDir(dbPath: string): void {
  if (dbPath === ":memory:") return;
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY NOT NULL,
      hash TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
    CREATE INDEX IF NOT EXISTS idx_chunks_range ON chunks(path, startLine, endLine);

    -- Session transcripts (JSONL) are indexed separately to avoid path collisions
    -- with workspace files.
    CREATE TABLE IF NOT EXISTS transcripts (
      sessionId TEXT PRIMARY KEY NOT NULL,
      hash TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      sessionId TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      role TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY(sessionId) REFERENCES transcripts(sessionId) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_transcript_chunks_session ON transcript_chunks(sessionId);
    CREATE INDEX IF NOT EXISTS idx_transcript_chunks_range ON transcript_chunks(sessionId, startLine, endLine);
  `);

  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const row = getMeta.get("schema_version") as { value: string } | undefined;
  if (!row) {
    const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    setMeta.run("schema_version", String(MEMORY_INDEX_SCHEMA_VERSION));
    return;
  }
  if (row.value !== String(MEMORY_INDEX_SCHEMA_VERSION)) {
    throw new Error(
      `Unsupported memory index schema version ${row.value}; expected ${MEMORY_INDEX_SCHEMA_VERSION}`
    );
  }
}

export function openMemoryIndexDbAtPath(dbPath: string): Database.Database {
  ensureDbDir(dbPath);
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

function assertSchemaVersionReadOnly(db: Database.Database): void {
  // Fail-closed: only accept an existing, supported schema.
  const hasMeta = db
    .prepare(
      "SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name='meta' LIMIT 1"
    )
    .get() as { ok: number } | undefined;
  if (!hasMeta) {
    throw new Error("Invalid memory index: missing meta table");
  }

  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get("schema_version") as { value: string } | undefined;

  if (!row) {
    throw new Error("Invalid memory index: missing schema_version");
  }
  if (row.value !== String(MEMORY_INDEX_SCHEMA_VERSION)) {
    throw new Error(
      `Unsupported memory index schema version ${row.value}; expected ${MEMORY_INDEX_SCHEMA_VERSION}`
    );
  }
}

/**
 * Open an existing memory index database in read-only mode.
 * Returns null if the DB file does not exist.
 */
export function openMemoryIndexDbReadOnlyAtPath(
  dbPath: string
): Database.Database | null {
  if (dbPath !== ":memory:" && !existsSync(dbPath)) {
    return null;
  }

  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: dbPath !== ":memory:",
  });

  try {
    db.pragma("foreign_keys = ON");
    assertSchemaVersionReadOnly(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

export function openMemoryIndexDb(params: {
  config: Config;
}): { db: Database.Database; path: string } {
  const memoryConfig = resolveMemorySearchConfig(params.config);
  const agentId = resolveAgentId({ config: params.config });
  const dbPath = resolveMemoryStorePath({ config: memoryConfig, agentId });
  const db = openMemoryIndexDbAtPath(dbPath);
  return { db, path: dbPath };
}
