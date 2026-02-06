/**
 * Read file tool - read text file contents with offset/limit support
 * Matches OpenClaw's group:fs read capability
 */

import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ToolDefinition } from "../interface.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("read-file");

/** Default maximum file size in bytes (50KB) */
const DEFAULT_MAX_SIZE = 50 * 1024;

/** Default maximum lines to return */
const DEFAULT_MAX_LINES = 2000;

/** Binary file signatures (magic bytes) */
const BINARY_SIGNATURES = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x50, 0x4b, 0x03, 0x04], // ZIP/DOCX/JAR
  [0x25, 0x50, 0x44, 0x46], // PDF
  [0x52, 0x49, 0x46, 0x46], // RIFF (WAV, AVI)
  [0x00, 0x00, 0x00], // Various binary formats
];

/**
 * Check if buffer contains binary content by examining magic bytes and null bytes
 */
function isBinaryContent(buffer: Buffer): boolean {
  // Check magic bytes
  for (const sig of BINARY_SIGNATURES) {
    if (buffer.length >= sig.length) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }

  // Check for null bytes in first 8KB (common binary indicator)
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }

  return false;
}

/**
 * Validate and resolve path within workspace bounds
 * Returns null if path is invalid or escapes workspace
 */
async function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string,
): Promise<{ absPath: string; relPath: string } | null> {
  // Basic validation
  if (!relativePath || typeof relativePath !== "string") return null;
  if (relativePath.includes("\0")) return null;
  if (relativePath.startsWith("/")) return null;

  // Resolve paths
  const absWorkspace = resolve(workspacePath);
  const absPath = resolve(workspacePath, relativePath);
  const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");

  // Check if resolved path is within workspace (lexically)
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) {
    return null;
  }

  // Verify parent directory resolves within workspace (symlink protection)
  try {
    const realWorkspace = await realpath(absWorkspace);
    const parentPath = resolve(absPath, "..");
    
    // Parent might not exist for new files, walk up to find existing ancestor
    let checkPath = parentPath;
    while (checkPath !== absWorkspace) {
      try {
        const realParent = await realpath(checkPath);
        const parentRel = relative(realWorkspace, realParent).replace(/\\/g, "/");
        if (parentRel.startsWith("..") || parentRel.startsWith("/")) {
          return null;
        }
        break;
      } catch {
        checkPath = resolve(checkPath, "..");
        if (checkPath === absWorkspace) break;
      }
    }
  } catch {
    return null;
  }

  // If file exists, verify it's not a symlink escaping workspace
  try {
    const fileStat = await lstat(absPath);
    if (fileStat.isSymbolicLink()) {
      return null;
    }
    if (!fileStat.isFile()) {
      return null;
    }

    // Verify realpath is within workspace
    const realWorkspace = await realpath(absWorkspace);
    const realFile = await realpath(absPath);
    const realRel = relative(realWorkspace, realFile).replace(/\\/g, "/");
    if (!realRel || realRel.startsWith("..") || realRel.startsWith("/")) {
      return null;
    }

    return { absPath: realFile, relPath: rel };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File doesn't exist - that's ok, we'll report it as not found
      return { absPath, relPath: rel };
    }
    return null;
  }
}

export function createReadFileTool(workspacePath: string): ToolDefinition {
  return {
    // Avoid collision with Claude Code builtin "Read" when using setup-token.
    name: "read_text_file",
    description:
      "Read the contents of a text file. Supports offset and limit for large files. " +
      "Use this to view source code, configuration, documentation, or any text file. " +
      "Binary files are rejected for safety.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace (e.g., 'src/index.ts' or 'README.md')",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed, default: 1)",
        },
        limit: {
          type: "number",
          description: `Maximum number of lines to read (default: ${DEFAULT_MAX_LINES})`,
        },
      },
      required: ["path"],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { path: relativePath, offset, limit } = params as {
        path: string;
        offset?: number;
        limit?: number;
      };

      // Resolve and validate path
      const resolved = await resolveWorkspacePath(workspacePath, relativePath);
      if (!resolved) {
        return {
          success: false,
          error: "Invalid path: must be a relative path within the workspace",
        };
      }

      const startLine = Math.max(1, offset ?? 1);
      const maxLines = Math.min(limit ?? DEFAULT_MAX_LINES, DEFAULT_MAX_LINES);

      try {
        // Open with O_NOFOLLOW to prevent symlink TOCTOU attacks
        let content: Buffer;
        try {
          const fh = await open(resolved.absPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            // Verify it's a regular file
            const fdStat = await fh.stat();
            if (!fdStat.isFile()) {
              return {
                success: false,
                error: `Not a regular file: ${resolved.relPath}`,
              };
            }

            // Check file size
            if (fdStat.size > DEFAULT_MAX_SIZE) {
              return {
                success: false,
                error: `File too large: ${resolved.relPath} (${fdStat.size} bytes, max ${DEFAULT_MAX_SIZE} bytes). Use offset/limit to read portions.`,
              };
            }

            content = await fh.readFile();
          } finally {
            await fh.close();
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          // Fallback for platforms without O_NOFOLLOW support
          if (code === "EINVAL" || code === "ENOSYS" || code === "EOPNOTSUPP") {
            const fallbackStat = await lstat(resolved.absPath);
            if (fallbackStat.isSymbolicLink() || !fallbackStat.isFile()) {
              return {
                success: false,
                error: `Not a regular file: ${resolved.relPath}`,
              };
            }
            if (fallbackStat.size > DEFAULT_MAX_SIZE) {
              return {
                success: false,
                error: `File too large: ${resolved.relPath} (${fallbackStat.size} bytes, max ${DEFAULT_MAX_SIZE} bytes)`,
              };
            }
            const { readFile } = await import("node:fs/promises");
            content = await readFile(resolved.absPath);
          } else {
            throw err;
          }
        }

        // Check for binary content
        if (isBinaryContent(content)) {
          return {
            success: false,
            error: `Binary file detected: ${resolved.relPath}. Use a specialized tool for binary files.`,
          };
        }

        // Decode as UTF-8
        const text = content.toString("utf-8");
        const allLines = text.split("\n");
        const totalLines = allLines.length;

        // Apply offset and limit
        const startIndex = startLine - 1;
        const endIndex = Math.min(startIndex + maxLines, totalLines);
        const selectedLines = allLines.slice(startIndex, endIndex);
        const truncated = endIndex < totalLines;

        return {
          success: true,
          data: {
            path: resolved.relPath,
            content: selectedLines.join("\n"),
            fromLine: startLine,
            toLine: startIndex + selectedLines.length,
            totalLines,
            truncated,
            sizeBytes: content.length,
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
        if (code === "EACCES") {
          return {
            success: false,
            error: `Permission denied: ${resolved.relPath}`,
          };
        }
        if (code === "ELOOP") {
          return {
            success: false,
            error: `Symbolic link not allowed: ${resolved.relPath}`,
          };
        }
        log.error(`Error reading file ${resolved.relPath}`, err);
        throw err;
      }
    },
  };
}
