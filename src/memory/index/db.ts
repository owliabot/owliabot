import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
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
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT,
      updatedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT,
      startLine INTEGER,
      endLine INTEGER,
      text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
    CREATE INDEX IF NOT EXISTS idx_chunks_range ON chunks(path, startLine, endLine);
  `);

  const setMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );
  setMeta.run("schema_version", String(MEMORY_INDEX_SCHEMA_VERSION));
}

export function openMemoryIndexDbAtPath(dbPath: string): Database.Database {
  ensureDbDir(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
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
