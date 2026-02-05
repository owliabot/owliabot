/**
 * List files tool - list directory contents
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "../interface.js";

/**
 * Options for creating the list_files tool
 */
export interface ListFilesToolOptions {
  /** Workspace directory path */
  workspace: string;
}

export function createListFilesTool(opts: ListFilesToolOptions): ToolDefinition {
  const { workspace: workspacePath } = opts;
  return {
    name: "list_files",
    description:
      "List files and directories in the workspace. Use this to discover what files are available.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path relative to workspace (default: root). Example: 'memory' or 'memory/diary'",
        },
      },
      required: [],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { path: relativePath } = params as { path?: string };
      const targetPath = relativePath
        ? join(workspacePath, relativePath)
        : workspacePath;

      // Security: ensure path is within workspace
      if (relativePath && (relativePath.includes("..") || relativePath.startsWith("/"))) {
        return {
          success: false,
          error: "Invalid path: must be relative to workspace",
        };
      }

      try {
        const entries = await readdir(targetPath);
        const results: Array<{ name: string; type: "file" | "dir" }> = [];

        for (const entry of entries) {
          // Skip hidden files
          if (entry.startsWith(".")) continue;

          const entryPath = join(targetPath, entry);
          const stats = await stat(entryPath);
          results.push({
            name: entry,
            type: stats.isDirectory() ? "dir" : "file",
          });
        }

        // Sort: directories first, then files
        results.sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return {
          success: true,
          data: {
            path: relativePath || ".",
            entries: results,
          },
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            success: false,
            error: `Directory not found: ${relativePath || "."}`,
          };
        }
        throw err;
      }
    },
  };
}
