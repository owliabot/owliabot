export interface Chunk {
  /** Workspace-relative path (posix style). */
  path: string;
  /** 1-indexed inclusive. */
  startLine: number;
  /** 1-indexed inclusive. */
  endLine: number;
  /** Raw chunk text. */
  text: string;
}

export interface ChunkingOptions {
  /** Rough target size for a chunk (characters). */
  targetChars?: number;
  /** Rough overlap between adjacent chunks (characters). */
  overlapChars?: number;
}

/**
 * Simple, deterministic chunker for markdown.
 *
 * PR3-2 phase 1: character/paragraph based (not token-based).
 * Later we can replace with token-aware chunking.
 */
export function chunkMarkdown(params: {
  relPath: string;
  content: string;
  options?: ChunkingOptions;
}): Chunk[] {
  const targetChars = Math.max(200, params.options?.targetChars ?? 1200);
  const overlapChars = Math.max(0, params.options?.overlapChars ?? 200);

  const lines = params.content.split("\n");
  const out: Chunk[] = [];

  let startLine = 1;
  let buf: string[] = [];
  let bufChars = 0;

  const flush = (endLine: number) => {
    const text = buf.join("\n").trimEnd();
    if (!text.trim()) return;
    out.push({
      path: params.relPath,
      startLine,
      endLine,
      text,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    buf.push(line);
    bufChars += line.length + 1;

    const isParagraphBreak = line.trim() === "";
    const shouldCut = bufChars >= targetChars && isParagraphBreak;

    if (shouldCut) {
      const endLine = i + 1;
      flush(endLine);

      // overlap: keep last N chars from buffer
      if (overlapChars > 0) {
        const joined = buf.join("\n");
        const tail = joined.slice(Math.max(0, joined.length - overlapChars));
        buf = tail.split("\n");
        // approximate new startLine
        startLine = endLine - (buf.length - 1);
        bufChars = buf.reduce((acc, l) => acc + l.length + 1, 0);
      } else {
        buf = [];
        bufChars = 0;
        startLine = endLine + 1;
      }
    }
  }

  if (buf.length > 0) {
    flush(lines.length);
  }

  return out;
}
