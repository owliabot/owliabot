import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { chunkMarkdown, type Chunk } from "./chunker.js";
import { openMemoryIndexDbAtPath } from "./db.js";
import { listMemoryFiles } from "./scanner.js";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function chunkId(chunk: Chunk): string {
  return createHash("sha256")
    .update(`${chunk.path}:${chunk.startLine}:${chunk.endLine}:${chunk.text}`)
    .digest("hex");
}

export async function indexMemory(params: {
  workspaceDir: string;
  extraPaths?: string[];
  dbPath: string;
}): Promise<void> {
  const db = openMemoryIndexDbAtPath(params.dbPath);

  try {
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

    const insertChunksTx = db.transaction((chunks: Chunk[]) => {
      for (const chunk of chunks) {
        insertChunk.run(
          chunkId(chunk),
          chunk.path,
          chunk.startLine,
          chunk.endLine,
          chunk.text
        );
      }
    });

    for (const file of files) {
      const content = await readFile(file.absPath, "utf-8");
      const hash = hashContent(content);
      const row = selectFile.get(file.relPath) as { hash: string } | undefined;
      const hashChanged = !row || row.hash !== hash;

      if (hashChanged) {
        deleteChunksByPath.run(file.relPath);
        const chunks = chunkMarkdown({ relPath: file.relPath, content });
        insertChunksTx(chunks);
      }

      upsertFile.run(file.relPath, hash, Date.now());
    }
  } finally {
    db.close();
  }
}
