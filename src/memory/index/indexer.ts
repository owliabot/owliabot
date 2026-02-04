import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { chunkMarkdown, type Chunk } from "./chunker.js";
import { openMemoryIndexDbAtPath } from "./db.js";
import { listMemoryFiles } from "./scanner.js";
import {
  formatTranscriptPath,
  listTranscriptFiles,
} from "./transcripts-scanner.js";

export type MemoryIndexSourceId = "files" | "transcripts";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function chunkId(chunk: Chunk): string {
  return createHash("sha256")
    .update(`${chunk.path}:${chunk.startLine}:${chunk.endLine}:${chunk.text}`)
    .digest("hex");
}

function transcriptChunkId(params: {
  sessionId: string;
  startLine: number;
  endLine: number;
  role: string;
  timestamp: number;
  text: string;
}): string {
  return createHash("sha256")
    .update(
      `${params.sessionId}:${params.startLine}:${params.endLine}:${params.role}:${params.timestamp}:${params.text}`
    )
    .digest("hex");
}

function normalizeRole(role: unknown): "user" | "assistant" | "system" | null {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return null;
}

async function indexFileMemory(params: {
  db: any;
  workspaceDir: string;
  extraPaths?: string[];
}): Promise<void> {
  const { db } = params;

  const files = await listMemoryFiles({
    workspaceDir: params.workspaceDir,
    extraPaths: params.extraPaths,
  });

  const selectFile = db.prepare("SELECT hash FROM files WHERE path = ?");
  const upsertFile = db.prepare(
    "INSERT INTO files (path, hash, updatedAt) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, updatedAt=excluded.updatedAt"
  );
  const deleteChunksByPath = db.prepare("DELETE FROM chunks WHERE path = ?");
  const insertChunk = db.prepare(
    "INSERT OR REPLACE INTO chunks (id, path, startLine, endLine, text) VALUES (?, ?, ?, ?, ?)"
  );

  const updateFileTx = db.transaction(
    (filePath: string, hash: string, chunks: Chunk[], updatedAt: number) => {
      upsertFile.run(filePath, hash, updatedAt);
      deleteChunksByPath.run(filePath);
      for (const chunk of chunks) {
        insertChunk.run(
          chunkId(chunk),
          chunk.path,
          chunk.startLine,
          chunk.endLine,
          chunk.text
        );
      }
    }
  );

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file.absPath, "utf-8");
    } catch {
      // Skip files that disappear or become unreadable during indexing.
      continue;
    }
    const hash = hashContent(content);
    const row = selectFile.get(file.relPath) as { hash: string } | undefined;
    const hashChanged = !row || row.hash !== hash;

    if (hashChanged) {
      const chunks = chunkMarkdown({ relPath: file.relPath, content });
      updateFileTx(file.relPath, hash, chunks, Date.now());
    }
  }

  if (files.length === 0) {
    db.prepare("DELETE FROM chunks").run();
    db.prepare("DELETE FROM files").run();
    return;
  }

  const filePaths = files.map((file) => file.relPath);

  // Avoid SQLite variable limits by using a temp table rather than
  // generating a huge `NOT IN (?, ?, ...)` list.
  db.exec("DROP TABLE IF EXISTS temp_current_paths");
  db.exec("CREATE TEMP TABLE temp_current_paths (path TEXT PRIMARY KEY NOT NULL)");

  const insertCurrentPath = db.prepare(
    "INSERT OR REPLACE INTO temp_current_paths (path) VALUES (?)"
  );
  const insertTx = db.transaction((paths: string[]) => {
    for (const p of paths) insertCurrentPath.run(p);
  });
  insertTx(filePaths);

  db.prepare(
    "DELETE FROM chunks WHERE path NOT IN (SELECT path FROM temp_current_paths)"
  ).run();
  db.prepare(
    "DELETE FROM files WHERE path NOT IN (SELECT path FROM temp_current_paths)"
  ).run();

  db.exec("DROP TABLE IF EXISTS temp_current_paths");
}

async function indexSessionTranscripts(params: {
  db: any;
  sessionsDir?: string;
}): Promise<void> {
  const { db } = params;

  const transcriptFiles = await listTranscriptFiles({ sessionsDir: params.sessionsDir });

  const selectTranscript = db.prepare(
    "SELECT hash FROM transcripts WHERE sessionId = ?"
  );
  const upsertTranscript = db.prepare(
    "INSERT INTO transcripts (sessionId, hash, updatedAt) VALUES (?, ?, ?) ON CONFLICT(sessionId) DO UPDATE SET hash=excluded.hash, updatedAt=excluded.updatedAt"
  );
  const deleteChunksBySession = db.prepare(
    "DELETE FROM transcript_chunks WHERE sessionId = ?"
  );
  const insertTranscriptChunk = db.prepare(
    "INSERT OR REPLACE INTO transcript_chunks (id, sessionId, startLine, endLine, role, timestamp, text) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  const updateTranscriptTx = db.transaction(
    (
      sessionId: string,
      hash: string,
      chunks: Array<{
        startLine: number;
        endLine: number;
        role: string;
        timestamp: number;
        text: string;
      }>,
      updatedAt: number
    ) => {
      upsertTranscript.run(sessionId, hash, updatedAt);
      deleteChunksBySession.run(sessionId);
      for (const c of chunks) {
        insertTranscriptChunk.run(
          transcriptChunkId({
            sessionId,
            startLine: c.startLine,
            endLine: c.endLine,
            role: c.role,
            timestamp: c.timestamp,
            text: c.text,
          }),
          sessionId,
          c.startLine,
          c.endLine,
          c.role,
          c.timestamp,
          c.text
        );
      }
    }
  );

  for (const tf of transcriptFiles) {
    let content: string;
    try {
      content = await readFile(tf.absPath, "utf-8");
    } catch {
      continue;
    }

    const hash = hashContent(content);
    const row = selectTranscript.get(tf.sessionId) as { hash: string } | undefined;
    const hashChanged = !row || row.hash !== hash;

    if (!hashChanged) continue;

    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const chunks: Array<{
      startLine: number;
      endLine: number;
      role: string;
      timestamp: number;
      text: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const role = normalizeRole(parsed?.role);
      const textContent = typeof parsed?.content === "string" ? parsed.content : null;
      const timestamp = typeof parsed?.timestamp === "number" ? parsed.timestamp : 0;

      if (!role || !textContent) continue;

      // Store a searchable line; include role prefix for basic context.
      const text = `${role}: ${textContent}`.trimEnd();
      if (!text.trim()) continue;

      const startLine = i + 1;
      chunks.push({
        startLine,
        endLine: startLine,
        role,
        timestamp,
        text,
      });
    }

    updateTranscriptTx(tf.sessionId, hash, chunks, Date.now());
  }

  if (transcriptFiles.length === 0) {
    db.prepare("DELETE FROM transcript_chunks").run();
    db.prepare("DELETE FROM transcripts").run();
    return;
  }

  const sessionIds = transcriptFiles.map((f) => f.sessionId);

  db.exec("DROP TABLE IF EXISTS temp_current_transcripts");
  db.exec(
    "CREATE TEMP TABLE temp_current_transcripts (sessionId TEXT PRIMARY KEY NOT NULL)"
  );

  const insertCurrent = db.prepare(
    "INSERT OR REPLACE INTO temp_current_transcripts (sessionId) VALUES (?)"
  );
  const insertTx = db.transaction((ids: string[]) => {
    for (const id of ids) insertCurrent.run(id);
  });
  insertTx(sessionIds);

  db.prepare(
    "DELETE FROM transcript_chunks WHERE sessionId NOT IN (SELECT sessionId FROM temp_current_transcripts)"
  ).run();
  db.prepare(
    "DELETE FROM transcripts WHERE sessionId NOT IN (SELECT sessionId FROM temp_current_transcripts)"
  ).run();

  db.exec("DROP TABLE IF EXISTS temp_current_transcripts");
}

export async function indexMemory(params: {
  workspaceDir: string;
  extraPaths?: string[];
  dbPath: string;
  sources?: MemoryIndexSourceId[];
  /** Trusted override only; will be rejected unless it matches the default sessionsDir. */
  sessionsDir?: string;
}): Promise<void> {
  const db = openMemoryIndexDbAtPath(params.dbPath);

  const sources = (params.sources ?? ["files"]).filter(
    (s): s is MemoryIndexSourceId => s === "files" || s === "transcripts"
  );

  try {
    if (sources.includes("files")) {
      await indexFileMemory({
        db,
        workspaceDir: params.workspaceDir,
        extraPaths: params.extraPaths,
      });
    }

    if (sources.includes("transcripts")) {
      // NOTE: `sessionsDir` is validated inside listTranscriptFiles().
      await indexSessionTranscripts({ db, sessionsDir: params.sessionsDir });
    }

    // Always update the last_indexed_at timestamp so the DB mtime advances even
    // when no content changed. This prevents perpetual staleness when file mtimes
    // are newer but content hashes are identical (e.g. `touch`, editor save w/o diff).
    const setMeta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );
    setMeta.run("last_indexed_at", String(Date.now()));
  } finally {
    db.close();
  }
}

// Re-export for consumers (memory-search) so they can format paths consistently.
export { formatTranscriptPath };
