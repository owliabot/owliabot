/**
 * Memory get tool - retrieve specific lines from a file
 */

import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ToolDefinition } from "../interface.js";

export function createMemoryGetTool(workspacePath: string): ToolDefinition {
  return {
    name: "memory_get",
    description:
      "Get specific lines from a memory file. Use this after memory_search to read more context.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to workspace (e.g., 'memory/diary/2026-01-25.md')",
        },
        from_line: {
          type: "number",
          description: "Starting line number (1-indexed, default: 1)",
        },
        num_lines: {
          type: "number",
          description: "Number of lines to read (default: 20)",
        },
      },
      required: ["path"],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { path, from_line, num_lines } = params as {
        path: string;
        from_line?: number;
        num_lines?: number;
      };

      const raw = path.trim();

      // Security boundary (OpenClaw-style): only allow MEMORY.md + memory/**/*.md
      // - must be relative
      // - must be .md
      // - must resolve inside workspace
      // - must not be a symlink
      const resolveAllowedPath = async (): Promise<{ absPath: string; relPath: string } | null> => {
        if (!raw) return null;
        if (raw.startsWith("/")) return null;
        if (raw.includes("\0")) return null;
        if (!raw.endsWith(".md")) return null;

        // Resolve and ensure the *lexical* path is within workspace.
        const absWorkspace = resolve(workspacePath);
        const absPath = resolve(workspacePath, raw);
        const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");
        const inWorkspace = rel.length > 0 && !rel.startsWith("..");
        if (!inWorkspace) return null;

        // Allowed roots: MEMORY.md or memory/**
        const isAllowed = rel === "MEMORY.md" || rel.startsWith("memory/");
        if (!isAllowed) return null;

        // Fail-closed on symlink directory escapes: validate realpath of workspace + parent directory
        // (works even when the file itself doesn't exist yet).
        try {
          const realWorkspace = await realpath(absWorkspace);
          const realParent = await realpath(resolve(absPath, ".."));
          const parentRel = relative(realWorkspace, realParent).replace(/\\/g, "/");
          const parentInWorkspace = parentRel.length >= 0 && !parentRel.startsWith("..");
          if (!parentInWorkspace) return null;
        } catch {
          return null;
        }

        // If file exists, require it to be a non-symlink file and use its real path.
        try {
          const stat = await lstat(absPath);
          if (stat.isSymbolicLink() || !stat.isFile()) return null;

          const realWorkspace = await realpath(absWorkspace);
          const realTarget = await realpath(absPath);
          const realRel = relative(realWorkspace, realTarget).replace(/\\/g, "/");
          const realInWorkspace = realRel.length > 0 && !realRel.startsWith("..");
          if (!realInWorkspace) return null;
          const realAllowed = realRel === "MEMORY.md" || realRel.startsWith("memory/");
          if (!realAllowed) return null;

          return { absPath: realTarget, relPath: realRel };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            // Allowed path but missing is handled later as ENOENT
            return { absPath, relPath: rel };
          }
          return null;
        }
      };

      const resolved = await resolveAllowedPath();
      if (!resolved) {
        return { success: false, error: "path required" };
      }

      const startLine = (from_line ?? 1) - 1; // Convert to 0-indexed
      const lineCount = num_lines ?? 20;

      try {
        // Mitigate TOCTOU: open with O_NOFOLLOW (best-effort; Linux supported).
        // If the OS doesn't support O_NOFOLLOW or the target is swapped, this may still fail.
        let content: string;
        try {
          const fh = await open(resolved.absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            content = await fh.readFile({ encoding: "utf-8" });
          } finally {
            await fh.close();
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          // Only fallback on platforms/filesystems that don't support O_NOFOLLOW.
          // Never fallback for symlink-related errors (e.g., ELOOP) or permission errors.
          const okToFallback = code === "EINVAL" || code === "ENOSYS" || code === "EOPNOTSUPP";
          if (!okToFallback) throw err;
          content = await readFile(resolved.absPath, "utf-8");
        }
        const lines = content.split("\n");
        const endLine = Math.min(startLine + lineCount, lines.length);
        const selectedLines = lines.slice(startLine, endLine);

        return {
          success: true,
          data: {
            path: resolved.relPath,
            from_line: startLine + 1,
            to_line: endLine,
            total_lines: lines.length,
            content: selectedLines.join("\n"),
          },
        };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return {
            success: false,
            error: `File not found: ${resolved.relPath}`,
          };
        }
        throw err;
      }
    },
  };
}
