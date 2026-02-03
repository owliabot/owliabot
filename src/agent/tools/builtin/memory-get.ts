/**
 * Memory get tool - retrieve specific lines from a file
 */

import { lstat, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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

        const absWorkspace = resolve(workspacePath);
        const absPath = resolve(workspacePath, raw);
        const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");

        const inWorkspace = rel.length > 0 && !rel.startsWith("..");
        if (!inWorkspace) return null;

        const isAllowed = rel === "MEMORY.md" || rel.startsWith("memory/");
        if (!isAllowed) return null;

        try {
          const stat = await lstat(absPath);
          if (stat.isSymbolicLink() || !stat.isFile()) return null;
        } catch {
          // Allowed path but missing is handled later as ENOENT
          return { absPath, relPath: rel };
        }

        return { absPath, relPath: rel };
      };

      const resolved = await resolveAllowedPath();
      if (!resolved) {
        return { success: false, error: "path required" };
      }

      const startLine = (from_line ?? 1) - 1; // Convert to 0-indexed
      const lineCount = num_lines ?? 20;

      try {
        const content = await readFile(resolved.absPath, "utf-8");
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
