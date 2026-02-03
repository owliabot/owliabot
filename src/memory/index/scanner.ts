import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export interface ScanResult {
  absPath: string;
  relPath: string; // posix
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

async function listMarkdownFilesRecursive(dirAbs: string, dirRel: string): Promise<ScanResult[]> {
  const out: ScanResult[] = [];
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    const rel = toPosix(path.join(dirRel, entry.name));

    if (entry.isDirectory()) {
      // ignore symlink directories
      try {
        const st = await lstat(abs);
        if (st.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      out.push(...(await listMarkdownFilesRecursive(abs, rel)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;

    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) continue;
    } catch {
      continue;
    }

    out.push({ absPath: abs, relPath: rel });
  }

  return out;
}

export async function listMemoryFiles(params: {
  workspaceDir: string;
  extraPaths?: string[];
}): Promise<ScanResult[]> {
  const out: ScanResult[] = [];
  const workspaceDir = path.resolve(params.workspaceDir);

  // MEMORY.md (optional)
  const memoryMdAbs = path.join(workspaceDir, "MEMORY.md");
  try {
    const st = await lstat(memoryMdAbs);
    if (st.isFile() && !st.isSymbolicLink()) {
      out.push({ absPath: memoryMdAbs, relPath: "MEMORY.md" });
    }
  } catch {
    // ignore
  }

  // memory/ (optional)
  const memoryDirAbs = path.join(workspaceDir, "memory");
  try {
    const st = await lstat(memoryDirAbs);
    if (st.isDirectory() && !st.isSymbolicLink()) {
      out.push(...(await listMarkdownFilesRecursive(memoryDirAbs, "memory")));
    }
  } catch {
    // ignore
  }

  // extraPaths (PR3-2 phase 1: only allow paths inside workspace; ignore symlinks)
  const extra = params.extraPaths ?? [];
  for (const p of extra) {
    const abs = path.isAbsolute(p) ? p : path.join(workspaceDir, p);
    const resolved = path.resolve(abs);
    const rel = toPosix(path.relative(workspaceDir, resolved));
    if (!rel || rel.startsWith("..")) continue;

    try {
      const st = await lstat(resolved);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        out.push(...(await listMarkdownFilesRecursive(resolved, rel)));
      } else if (st.isFile() && resolved.endsWith(".md")) {
        out.push({ absPath: resolved, relPath: rel });
      }
    } catch {
      // ignore
    }
  }

  // Deduplicate by relPath and stable ordering.
  // Precedence rule: core memory sources (MEMORY.md + memory/) win over extraPaths.
  const byPath = new Map<string, ScanResult>();

  // Core sources were pushed first into `out`. Only set if missing.
  for (const entry of out) {
    if (!byPath.has(entry.relPath)) {
      byPath.set(entry.relPath, entry);
    }
  }

  const deduped = Array.from(byPath.values());
  deduped.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return deduped;
}
