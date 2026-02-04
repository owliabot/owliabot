import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface ScanResult {
  absPath: string;
  /** Workspace-relative, posix-normalized path (never starts with "./"). */
  relPath: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Normalize a workspace-relative path for stable dedupe + allowlist matching.
 *
 * Guarantees:
 * - posix separators
 * - no leading "./"
 * - no redundant segments
 */
function normalizeRelPath(input: string): string {
  let p = toPosix(input ?? "").trim();
  // Remove any leading "./" segments (can appear from user-supplied extraPaths).
  p = p.replace(/^\.\/+/, "");
  // Normalize (collapses //, /./, /../)
  p = path.posix.normalize(p);
  if (p === ".") return "";
  // Normalize can produce trailing slashes for empty-ish inputs; strip them.
  p = p.replace(/\/+$/, "");
  return p;
}

/**
 * Fail-closed check: returns true if any path segment (relative to workspaceDir)
 * is a symlink. This prevents extraPaths from escaping the workspace via an
 * intermediate symlink directory (lstat() only detects symlinks on the final
 * path component).
 */
async function hasSymlinkSegment(workspaceDir: string, relPosix: string): Promise<boolean> {
  const rel = normalizeRelPath(relPosix);
  if (!rel) return false;

  let realWorkspace: string;
  try {
    realWorkspace = await realpath(workspaceDir);
  } catch {
    return true; // fail closed
  }

  const parts = rel.split("/").filter(Boolean);
  let cur = workspaceDir;

  for (const part of parts) {
    cur = path.join(cur, part);
    try {
      const st = await lstat(cur);
      if (st.isSymbolicLink()) return true;

      // Defense-in-depth: verify realpath stays within workspace even for
      // non-symlink segments (guards against bind mounts, hardlinked dirs, etc.).
      if (st.isDirectory()) {
        const real = await realpath(cur);
        const relReal = path.relative(realWorkspace, real);
        if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
          return true; // escaped workspace
        }
      }
    } catch {
      // fail closed on any filesystem error
      return true;
    }
  }

  return false;
}

async function listMarkdownFilesRecursive(dirAbs: string, dirRel: string): Promise<ScanResult[]> {
  const out: ScanResult[] = [];
  const baseRel = normalizeRelPath(dirRel);

  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    const rel = normalizeRelPath(path.posix.join(baseRel, entry.name));

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
  const core: ScanResult[] = [];
  const extra: ScanResult[] = [];
  const workspaceDir = path.resolve(params.workspaceDir);

  // MEMORY.md (optional)
  const memoryMdAbs = path.join(workspaceDir, "MEMORY.md");
  try {
    const st = await lstat(memoryMdAbs);
    if (st.isFile() && !st.isSymbolicLink()) {
      core.push({ absPath: memoryMdAbs, relPath: "MEMORY.md" });
    }
  } catch {
    // ignore
  }

  // memory/ (optional)
  const memoryDirAbs = path.join(workspaceDir, "memory");
  try {
    const st = await lstat(memoryDirAbs);
    if (st.isDirectory() && !st.isSymbolicLink()) {
      core.push(...(await listMarkdownFilesRecursive(memoryDirAbs, "memory")));
    }
  } catch {
    // ignore
  }

  // extraPaths: only allow paths inside workspace; ignore symlinks.
  const extraPaths = params.extraPaths ?? [];
  for (const pRaw of extraPaths) {
    const p = (pRaw ?? "").trim();
    if (!p) continue;

    const abs = path.isAbsolute(p) ? p : path.join(workspaceDir, p);
    const resolved = path.resolve(abs);

    const relCandidate = normalizeRelPath(path.relative(workspaceDir, resolved));
    // Fail-closed: reject anything outside the workspace.
    if (!relCandidate || relCandidate === ".." || relCandidate.startsWith("../")) {
      continue;
    }

    // Fail-closed: do not allow extraPaths that traverse through a symlinked
    // directory inside the workspace.
    if (await hasSymlinkSegment(workspaceDir, relCandidate)) {
      continue;
    }

    try {
      const st = await lstat(resolved);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        extra.push(...(await listMarkdownFilesRecursive(resolved, relCandidate)));
      } else if (st.isFile() && resolved.endsWith(".md")) {
        extra.push({ absPath: resolved, relPath: relCandidate });
      }
    } catch {
      // ignore
    }
  }

  // Deduplicate by normalized relPath and stable ordering.
  // Explicit precedence rule: core memory sources (MEMORY.md + memory/) win over extraPaths.
  const byPath = new Map<string, ScanResult>();

  for (const entry of core) {
    const rel = normalizeRelPath(entry.relPath);
    if (!rel) continue;
    if (!byPath.has(rel)) byPath.set(rel, { ...entry, relPath: rel });
  }

  for (const entry of extra) {
    const rel = normalizeRelPath(entry.relPath);
    if (!rel) continue;
    if (!byPath.has(rel)) byPath.set(rel, { ...entry, relPath: rel });
  }

  const deduped = Array.from(byPath.values());
  deduped.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return deduped;
}
