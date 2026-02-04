/**
 * Memory search
 *
 * Provides a configurable provider chain (primary + optional fallback).
 *
 * Providers:
 * - sqlite: query the memory index DB (fast; does not re-read files)
 * - naive: scan allowlisted markdown files directly (slow; optional fallback only)
 *
 * Fail-closed: if providers are unavailable/error, return [].
 *
 * @see design.md Section 5.4
 */

import { mkdir, open as openFile, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { createLogger } from "../utils/logger.js";
import { listMemoryFiles } from "../memory/index/scanner.js";
import {
  formatTranscriptPath,
  listTranscriptFiles,
} from "../memory/index/transcripts-scanner.js";
import { openMemoryIndexDbReadOnlyAtPath } from "../memory/index/db.js";
import * as memoryIndexer from "../memory/index/indexer.js";
import type { MemorySearchProviderId } from "../memory/types.js";

const log = createLogger("memory-search");

export interface MemorySearchResult {
  path: string;
  /** 0-indexed inclusive (tool will render 1-indexed). */
  startLine: number;
  /** 0-indexed inclusive (tool will render 1-indexed). */
  endLine: number;
  score: number;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  /** Additional directories/files to allow (same semantics as indexer scanner). */
  extraPaths?: string[];
  /** Path to sqlite DB created by indexMemory (sqlite provider only). */
  dbPath?: string;

  /** Primary provider (default: sqlite). */
  provider?: MemorySearchProviderId;
  /** Optional fallback provider; only used if primary is unavailable/errors. */
  fallback?: MemorySearchProviderId | "none";

  /** Sources to search (default: ["files"]). */
  sources?: Array<"files" | "transcripts">;

  /**
   * Sqlite provider indexing behavior.
   * When autoIndex is true, we may build/refresh the sqlite DB on-demand before searching.
   */
  indexing?: {
    autoIndex?: boolean;
    minIntervalMs?: number;
    /** Optional override for which sources to index (defaults to `sources`). */
    sources?: Array<"files" | "transcripts">;
  };

  /**
   * Trusted override only; will be rejected unless it matches the default
   * sessionsDir for this host/user.
   */
  sessionsDir?: string;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function tokenizeQuery(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

function formatSnippet(text: string): string {
  const trimmed = text.trimEnd();
  const maxChars = 400;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}...`;
}

function normalizeSources(input: unknown): Array<"files" | "transcripts"> {
  const arr = Array.isArray(input) ? input : undefined;
  const raw = (arr ?? ["files"]).filter((s): s is string => typeof s === "string");
  const out: Array<"files" | "transcripts"> = [];
  for (const s of raw) {
    if (s === "files" || s === "transcripts") out.push(s);
  }
  return out.length > 0 ? Array.from(new Set(out)) : ["files"];
}

type AutoIndexState = {
  lastAttemptAtMs: number;
  inFlight: Promise<void> | null;
};

// Per-process throttle + mutex to avoid spawning multiple indexers for the same DB.
const autoIndexStateByDbPath = new Map<string, AutoIndexState>();

async function acquireIndexLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  try {
    await mkdir(path.dirname(lockPath), { recursive: true });
  } catch {
    // fail closed
    return null;
  }

  const tryOnce = async (): Promise<(() => Promise<void>) | null> => {
    try {
      const fh = await openFile(lockPath, "wx");
      try {
        await fh.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + "\n",
          "utf-8"
        );
      } catch {
        // ignore
      } finally {
        await fh.close();
      }

      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // ignore
        }
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") return null;

      // Stale lock cleanup (best-effort). If the lock is very old, assume the
      // process died and reclaim it.
      try {
        const st = await stat(lockPath);
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > 10 * 60 * 1000) {
          await unlink(lockPath);
        }
      } catch {
        // ignore
      }

      return null;
    }
  };

  // One attempt + one retry after stale cleanup.
  const release = await tryOnce();
  if (release) return release;
  return await tryOnce();
}

async function isDbMissingOrStale(params: {
  workspaceDir: string;
  extraPaths: string[];
  dbPath: string;
  sources: Array<"files" | "transcripts">;
  sessionsDir?: string;
}): Promise<boolean> {
  if (params.dbPath === ":memory:") return false;

  let dbMtimeMs = 0;
  try {
    const st = await stat(params.dbPath);
    dbMtimeMs = st.mtimeMs;
  } catch {
    return true; // missing or unreadable
  }

  // In WAL mode, recent writes may live in the -wal file and not bump the main
  // DB mtime until a checkpoint occurs. Consider companion files when checking
  // freshness.
  for (const suffix of ["-wal", "-shm"]) {
    try {
      const st = await stat(`${params.dbPath}${suffix}`);
      if (st.mtimeMs > dbMtimeMs) dbMtimeMs = st.mtimeMs;
    } catch {
      // ignore
    }
  }

  const wantFiles = params.sources.includes("files");
  const wantTranscripts = params.sources.includes("transcripts");

  let latestSourceMtimeMs = 0;

  if (wantFiles) {
    const files = await listMemoryFiles({
      workspaceDir: params.workspaceDir,
      extraPaths: params.extraPaths,
    });
    for (const f of files) {
      try {
        const st = await stat(f.absPath);
        if (st.mtimeMs > latestSourceMtimeMs) latestSourceMtimeMs = st.mtimeMs;
      } catch {
        // ignore
      }
    }
  }

  if (wantTranscripts) {
    const transcripts = await listTranscriptFiles({ sessionsDir: params.sessionsDir });
    for (const t of transcripts) {
      try {
        const st = await stat(t.absPath);
        if (st.mtimeMs > latestSourceMtimeMs) latestSourceMtimeMs = st.mtimeMs;
      } catch {
        // ignore
      }
    }
  }

  // If there are no allowed sources, treat index as not stale (search will return []).
  if (latestSourceMtimeMs <= 0) return false;

  return latestSourceMtimeMs > dbMtimeMs;
}

async function maybeAutoIndexForSqliteSearch(params: {
  workspaceDir: string;
  extraPaths: string[];
  dbPath?: string;
  sources: Array<"files" | "transcripts">;
  sessionsDir?: string;
  indexing?: {
    autoIndex?: boolean;
    minIntervalMs?: number;
    sources?: Array<"files" | "transcripts">;
  };
}): Promise<void> {
  const dbPath = params.dbPath;
  if (!dbPath) return;
  if (dbPath === ":memory:") return;

  const autoIndex = params.indexing?.autoIndex === true;
  if (!autoIndex) return;

  const minIntervalMsRaw = params.indexing?.minIntervalMs;
  const minIntervalMs =
    typeof minIntervalMsRaw === "number" &&
    Number.isFinite(minIntervalMsRaw) &&
    minIntervalMsRaw >= 0
      ? Math.floor(minIntervalMsRaw)
      : 5 * 60 * 1000;

  const sources = normalizeSources(params.indexing?.sources ?? params.sources);

  const existing = autoIndexStateByDbPath.get(dbPath);
  if (existing?.inFlight) {
    await existing.inFlight;
    return;
  }

  const state: AutoIndexState = existing ?? {
    lastAttemptAtMs: 0,
    inFlight: null,
  };

  // Create a single shared "attempt" promise so concurrent callers will wait for
  // the same staleness check + potential index build.
  state.inFlight = (async () => {
    const now = Date.now();
    if (now - state.lastAttemptAtMs < minIntervalMs) return;

    // Throttle the (potentially expensive) staleness check itself, not just the
    // indexing work.
    state.lastAttemptAtMs = now;

    let needsIndex = false;
    try {
      needsIndex = await isDbMissingOrStale({
        workspaceDir: params.workspaceDir,
        extraPaths: params.extraPaths,
        dbPath,
        sources,
        sessionsDir: params.sessionsDir,
      });
    } catch {
      // fail closed: don't index if we can't reliably determine staleness
      return;
    }

    if (!needsIndex) return;

    const lockPath = `${dbPath}.index.lock`;
    const release = await acquireIndexLock(lockPath);
    if (!release) return;

    try {
      await memoryIndexer.indexMemory({
        workspaceDir: params.workspaceDir,
        extraPaths: params.extraPaths,
        dbPath,
        sources,
        sessionsDir: params.sessionsDir,
      });
    } catch (err) {
      // Fail-closed: search should proceed (and may fallback).
      log.warn("Auto-indexing failed", err);
    } finally {
      await release();
    }
  })().finally(() => {
    state.inFlight = null;
  });

  autoIndexStateByDbPath.set(dbPath, state);
  await state.inFlight;
}

export function __resetAutoIndexStateForTests(): void {
  autoIndexStateByDbPath.clear();
}

async function trySearchSqlite(params: {
  workspaceDir: string;
  query: string;
  maxResults: number;
  extraPaths: string[];
  dbPath?: string;
  sources: Array<"files" | "transcripts">;
  sessionsDir?: string;
}): Promise<MemorySearchResult[] | null> {
  const q = (params.query ?? "").trim();
  if (!q) return [];

  const dbPath = params.dbPath;
  if (!dbPath) {
    log.debug("No dbPath provided for sqlite memory search");
    return null;
  }

  const wantFiles = params.sources.includes("files");
  const wantTranscripts = params.sources.includes("transcripts");

  // Fail-closed allowlists.
  const allowedFiles = wantFiles
    ? await listMemoryFiles({
        workspaceDir: params.workspaceDir,
        extraPaths: params.extraPaths,
      })
    : [];
  const allowedFilePaths = allowedFiles.map((f) => f.relPath);

  const transcriptFiles = wantTranscripts
    ? await listTranscriptFiles({ sessionsDir: params.sessionsDir })
    : [];
  let allowedSessionIds = transcriptFiles.map((f) => f.sessionId);

  if (allowedFilePaths.length === 0 && allowedSessionIds.length === 0) return [];

  // For stable ordering: core memory sources win over extraPaths on tie.
  const coreFiles = wantFiles
    ? await listMemoryFiles({
        workspaceDir: params.workspaceDir,
        extraPaths: [],
      })
    : [];
  const coreSet = new Set(coreFiles.map((f) => f.relPath));

  let db;
  try {
    db = openMemoryIndexDbReadOnlyAtPath(dbPath);
  } catch (err) {
    log.warn("Failed to open memory index", err);
    return null;
  }
  if (!db) return null;

  // Back-compat: a schema_version=1 DB created by older builds may be missing the
  // transcript tables. In that case, keep sqlite search working for files and
  // simply skip transcript results (re-indexing will create the tables).
  if (allowedSessionIds.length > 0) {
    const hasTranscripts = db
      .prepare(
        "SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name='transcripts' LIMIT 1"
      )
      .get() as { ok: number } | undefined;
    const hasTranscriptChunks = db
      .prepare(
        "SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name='transcript_chunks' LIMIT 1"
      )
      .get() as { ok: number } | undefined;

    if (!hasTranscripts?.ok || !hasTranscriptChunks?.ok) {
      allowedSessionIds = [];
    }
  }

  try {
    const phraseLower = q.toLowerCase();
    const tokensLower = tokenizeQuery(q).slice(0, 20);

    const likePatterns = [phraseLower, ...tokensLower]
      .filter(Boolean)
      .map((t) => `%${escapeLike(t)}%`);

    if (likePatterns.length === 0) return [];

    // Temp allowlists to avoid SQLite variable limits.
    db.exec("DROP TABLE IF EXISTS temp_allowed_paths");
    db.exec(
      "CREATE TEMP TABLE temp_allowed_paths (path TEXT PRIMARY KEY NOT NULL, isCore INTEGER NOT NULL)"
    );

    const insertAllowed = db.prepare(
      "INSERT OR REPLACE INTO temp_allowed_paths (path, isCore) VALUES (?, ?)"
    );
    const insertAllowedTx = db.transaction((paths: string[]) => {
      for (const p of paths) insertAllowed.run(p, coreSet.has(p) ? 1 : 0);
    });
    if (allowedFilePaths.length > 0) insertAllowedTx(allowedFilePaths);

    db.exec("DROP TABLE IF EXISTS temp_allowed_transcripts");
    db.exec(
      "CREATE TEMP TABLE temp_allowed_transcripts (sessionId TEXT PRIMARY KEY NOT NULL)"
    );
    const insertAllowedSession = db.prepare(
      "INSERT OR REPLACE INTO temp_allowed_transcripts (sessionId) VALUES (?)"
    );
    const insertAllowedSessionTx = db.transaction((ids: string[]) => {
      for (const id of ids) insertAllowedSession.run(id);
    });
    if (allowedSessionIds.length > 0) insertAllowedSessionTx(allowedSessionIds);

    const makeScoreExpr = (textCol: string): string => {
      const parts: string[] = [];
      parts.push(
        `(CASE WHEN ${textCol} LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 3 ELSE 0 END)`
      );
      for (let i = 0; i < tokensLower.length; i++) {
        parts.push(
          `(CASE WHEN ${textCol} LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1 ELSE 0 END)`
        );
      }
      return parts.join(" + ");
    };

    const makeWhereExpr = (textCol: string): string => {
      const whereParts = likePatterns.map(
        () => `${textCol} LIKE ? ESCAPE '\\' COLLATE NOCASE`
      );
      return whereParts.join(" OR ");
    };

    const selects: Array<{ sql: string; params: any[] }> = [];

    if (allowedFilePaths.length > 0) {
      const sql = `
        SELECT
          c.path as path,
          c.startLine as startLine,
          c.endLine as endLine,
          c.text as text,
          (${makeScoreExpr("c.text")}) as score,
          ap.isCore as isCore,
          1 as sourcePriority
        FROM chunks c
        JOIN temp_allowed_paths ap ON ap.path = c.path
        WHERE (${makeWhereExpr("c.text")})
      `;
      const scoreParams = likePatterns;
      const queryParams = [...scoreParams, ...likePatterns];
      selects.push({ sql, params: queryParams });
    }

    if (allowedSessionIds.length > 0) {
      const sql = `
        SELECT
          ('transcript:' || t.sessionId) as path,
          t.startLine as startLine,
          t.endLine as endLine,
          t.text as text,
          (${makeScoreExpr("t.text")}) as score,
          0 as isCore,
          0 as sourcePriority
        FROM transcript_chunks t
        JOIN temp_allowed_transcripts at ON at.sessionId = t.sessionId
        WHERE (${makeWhereExpr("t.text")})
      `;
      const scoreParams = likePatterns;
      const queryParams = [...scoreParams, ...likePatterns];
      selects.push({ sql, params: queryParams });
    }

    if (selects.length === 0) return [];

    const unionSql = selects.map((s) => s.sql.trim()).join("\nUNION ALL\n");
    const sql = `
      ${unionSql}
      ORDER BY score DESC, isCore DESC, sourcePriority DESC, path ASC, startLine ASC
      LIMIT ?
    `;

    const allParams: any[] = [];
    for (const s of selects) allParams.push(...s.params);
    allParams.push(Math.max(params.maxResults, 1));

    const stmt = db.prepare(sql);
    const raw = stmt.all(...allParams) as Array<{
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      score: number;
      isCore: number;
      sourcePriority: number;
    }>;

    const scored: MemorySearchResult[] = raw
      .map((row) => ({
        path: row.path,
        startLine: Math.max(0, row.startLine - 1),
        endLine: Math.max(0, row.endLine - 1),
        score: Number(row.score) || 0,
        snippet: formatSnippet(row.text),
      }))
      .filter((r) => r.score > 0);

    // Extra determinism: apply same tie-break in JS.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aCore = coreSet.has(a.path) ? 1 : 0;
      const bCore = coreSet.has(b.path) ? 1 : 0;
      if (bCore !== aCore) return bCore - aCore;
      const aIsFile = a.path.startsWith("transcript:") ? 0 : 1;
      const bIsFile = b.path.startsWith("transcript:") ? 0 : 1;
      if (bIsFile !== aIsFile) return bIsFile - aIsFile;
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.startLine - b.startLine;
    });

    return scored.slice(0, params.maxResults);
  } catch (err) {
    // Primary provider error should trigger fallback (if configured).
    log.warn("SQLite memory search failed", err);
    return null;
  } finally {
    try {
      db.exec("DROP TABLE IF EXISTS temp_allowed_paths");
      db.exec("DROP TABLE IF EXISTS temp_allowed_transcripts");
    } catch {
      // ignore
    }
    db.close();
  }
}

async function trySearchNaive(params: {
  workspaceDir: string;
  query: string;
  maxResults: number;
  extraPaths: string[];
  sources: Array<"files" | "transcripts">;
  sessionsDir?: string;
}): Promise<MemorySearchResult[] | null> {
  const q = (params.query ?? "").trim();
  if (!q) return [];

  const wantFiles = params.sources.includes("files");
  const wantTranscripts = params.sources.includes("transcripts");

  const allowedFiles = wantFiles
    ? await listMemoryFiles({
        workspaceDir: params.workspaceDir,
        extraPaths: params.extraPaths,
      })
    : [];

  const transcriptFiles = wantTranscripts
    ? await listTranscriptFiles({ sessionsDir: params.sessionsDir })
    : [];

  if (allowedFiles.length === 0 && transcriptFiles.length === 0) return [];

  // For stable ordering: core memory sources win over extraPaths on tie.
  const coreFiles = wantFiles
    ? await listMemoryFiles({
        workspaceDir: params.workspaceDir,
        extraPaths: [],
      })
    : [];
  const coreSet = new Set(coreFiles.map((f) => f.relPath));

  const phraseLower = q.toLowerCase();
  const tokensLower = tokenizeQuery(q).slice(0, 20);

  const results: MemorySearchResult[] = [];

  if (allowedFiles.length > 0) {
    for (const file of allowedFiles) {
      let content: string;
      try {
        content = await readFile(file.absPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      let bestScore = 0;
      let bestLine = -1;
      let bestText = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const lower = line.toLowerCase();

        let score = 0;
        if (phraseLower && lower.includes(phraseLower)) score += 3;
        for (const t of tokensLower) {
          if (t && lower.includes(t)) score += 1;
        }

        if (score > bestScore) {
          bestScore = score;
          bestLine = i;
          bestText = line;
        }
      }

      if (bestScore > 0 && bestLine >= 0) {
        results.push({
          path: file.relPath,
          startLine: bestLine,
          endLine: bestLine,
          score: bestScore,
          snippet: formatSnippet(bestText),
        });
      }
    }
  }

  if (transcriptFiles.length > 0) {
    for (const tf of transcriptFiles) {
      let content: string;
      try {
        content = await readFile(tf.absPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/).filter((l) => l.trim());

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] ?? "";
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }

        const role = parsed?.role;
        const textContent = typeof parsed?.content === "string" ? parsed.content : "";
        const text = `${role}: ${textContent}`.trimEnd();
        const lower = text.toLowerCase();

        let score = 0;
        if (phraseLower && lower.includes(phraseLower)) score += 3;
        for (const t of tokensLower) {
          if (t && lower.includes(t)) score += 1;
        }

        if (score > 0) {
          const startLine = i; // 0-indexed for MemorySearchResult
          results.push({
            path: formatTranscriptPath(tf.sessionId),
            startLine,
            endLine: startLine,
            score,
            snippet: formatSnippet(text),
          });
        }
      }
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aCore = coreSet.has(a.path) ? 1 : 0;
    const bCore = coreSet.has(b.path) ? 1 : 0;
    if (bCore !== aCore) return bCore - aCore;
    const aIsFile = a.path.startsWith("transcript:") ? 0 : 1;
    const bIsFile = b.path.startsWith("transcript:") ? 0 : 1;
    if (bIsFile !== aIsFile) return bIsFile - aIsFile;
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return a.startLine - b.startLine;
  });

  return results.slice(0, params.maxResults);
}

export async function searchMemory(
  workspacePath: string,
  query: string,
  options?: SearchOptions
): Promise<MemorySearchResult[]> {
  const q = (query ?? "").trim();
  if (!q) return [];

  const maxResults = options?.maxResults ?? 10;
  const extraPaths = options?.extraPaths ?? [];
  const dbPath = options?.dbPath;

  const provider: MemorySearchProviderId = options?.provider ?? "sqlite";
  const fallback = options?.fallback ?? "none";

  const sources = normalizeSources(options?.sources);

  const baseParams = {
    workspaceDir: workspacePath,
    query: q,
    maxResults: Math.max(maxResults, 1),
    extraPaths,
    dbPath,
    sources,
    sessionsDir: options?.sessionsDir,
  };

  const run = async (
    id: MemorySearchProviderId
  ): Promise<MemorySearchResult[] | null> => {
    if (id === "sqlite") {
      await maybeAutoIndexForSqliteSearch({
        workspaceDir: baseParams.workspaceDir,
        extraPaths: baseParams.extraPaths,
        dbPath: baseParams.dbPath,
        sources: baseParams.sources,
        sessionsDir: baseParams.sessionsDir,
        indexing: options?.indexing,
      });
      return trySearchSqlite(baseParams);
    }
    if (id === "naive") {
      return trySearchNaive(baseParams);
    }
    return null;
  };

  const primaryRes = await run(provider);
  if (primaryRes !== null) return primaryRes;

  if (fallback !== "none") {
    const fallbackRes = await run(fallback);
    if (fallbackRes !== null) return fallbackRes;
  }

  // Fail-closed.
  return [];
}
