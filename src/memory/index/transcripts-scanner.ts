import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface TranscriptScanResult {
  absPath: string;
  /** Session id derived from the transcript filename (without .jsonl). */
  sessionId: string;
}

function defaultSessionsDir(): string {
  // Aligned with src/entry.ts (do not trust arbitrary config; use process env).
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(homeDir, ".owliabot", "sessions");
}

function isSafeFilename(name: string): boolean {
  // Matches safeFile() behavior from src/agent/session-transcript.ts
  // (UUIDs will pass).
  return /^[a-zA-Z0-9._-]+\.jsonl$/.test(name);
}

function extractSessionId(filename: string): string {
  return filename.replace(/\.jsonl$/i, "");
}

/**
 * List transcript JSONL files from <sessionsDir>/transcripts.
 *
 * Security boundary (fail-closed):
 * - sessionsDir is not user-configurable; if provided, it must match the
 *   default sessionsDir for this host/user.
 * - ignores symlinks
 * - validates realpath stays inside transcriptsDir
 */
export async function listTranscriptFiles(params?: {
  sessionsDir?: string;
}): Promise<TranscriptScanResult[]> {
  const expectedSessionsDir = path.resolve(defaultSessionsDir());
  const sessionsDir = path.resolve(params?.sessionsDir ?? expectedSessionsDir);

  if (sessionsDir !== expectedSessionsDir) {
    // Fail-closed: do not allow arbitrary paths.
    return [];
  }

  const transcriptsDir = path.join(sessionsDir, "transcripts");

  // Fail-closed: do not follow a symlinked transcripts directory.
  // Otherwise a local user could point transcriptsDir at arbitrary readable paths.
  try {
    const st = await lstat(transcriptsDir);
    if (!st.isDirectory() || st.isSymbolicLink()) return [];
  } catch {
    return [];
  }

  let realTranscriptsDir: string;
  try {
    realTranscriptsDir = await realpath(transcriptsDir);
  } catch {
    return [];
  }

  let entries;
  try {
    entries = await readdir(transcriptsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: TranscriptScanResult[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isSafeFilename(entry.name)) continue;

    const abs = path.join(transcriptsDir, entry.name);

    // Ignore symlinks.
    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink() || !st.isFile()) continue;
    } catch {
      continue;
    }

    // Ensure the resolved path is still inside transcriptsDir.
    try {
      const realFile = await realpath(abs);
      const rel = path.relative(realTranscriptsDir, realFile);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    } catch {
      continue;
    }

    out.push({
      absPath: abs,
      sessionId: extractSessionId(entry.name),
    });
  }

  out.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return out;
}

export function formatTranscriptPath(sessionId: string): string {
  // Namespaced to avoid collisions with workspace-relative file paths.
  return `transcript:${sessionId}`;
}
