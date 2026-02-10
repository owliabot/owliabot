/**
 * Delete file tool - remove files with the same workspace boundary checks as write_file
 */

import { lstat, realpath, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { ToolDefinition } from "../interface.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("delete-file");

/** Protected system paths that should never be modified */
const PROTECTED_PATHS = [
  ".git/config",
  ".git/HEAD",
  ".git/hooks",
  ".ssh",
  ".gnupg",
  ".npmrc",
  ".netrc",
  ".env",
  ".env.local",
  ".env.production",
] as const;

/** Protected filename patterns */
const PROTECTED_PATTERNS = [
  /^\.env(\..+)?$/, // .env, .env.local, .env.production, etc.
  /^id_[a-z]+$/, // SSH keys
  /^.*\.pem$/, // Certificates
  /^.*\.key$/, // Private keys
] as const;

function isProtectedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").pop() ?? "";

  for (const protected_ of PROTECTED_PATHS) {
    if (normalized === protected_ || normalized.startsWith(protected_ + "/")) {
      return true;
    }
  }

  for (const pattern of PROTECTED_PATTERNS) {
    if (pattern.test(basename)) {
      return true;
    }
  }

  return false;
}

async function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string,
): Promise<{ absPath: string; relPath: string } | null> {
  if (!relativePath || typeof relativePath !== "string") return null;
  if (relativePath.includes("\0")) return null;
  if (relativePath.startsWith("/")) return null;

  const absWorkspace = resolve(workspacePath);
  const absPath = resolve(workspacePath, relativePath);
  const rel = relative(absWorkspace, absPath).replace(/\\/g, "/");

  if (!rel || rel.startsWith("..") || rel.startsWith("/")) {
    return null;
  }

  if (isProtectedPath(rel)) {
    return null;
  }

  // Verify parent directory resolves within workspace (symlink protection)
  const parentPath = dirname(absPath);
  try {
    const realWorkspace = await realpath(absWorkspace);

    let checkPath = parentPath;
    while (true) {
      try {
        const realCheck = await realpath(checkPath);
        const checkRel = relative(realWorkspace, realCheck).replace(/\\/g, "/");
        if (checkRel.startsWith("..") || (checkRel.startsWith("/") && checkRel !== "")) {
          return null;
        }
        break;
      } catch {
        if (checkPath === absWorkspace) {
          break;
        }
        checkPath = dirname(checkPath);
      }
    }
  } catch {
    return null;
  }

  // If path exists, it must be a regular file (no symlinks, no directories)
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      return null;
    }
    if (st.isDirectory()) {
      return null;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return null;
    }
  }

  return { absPath, relPath: rel };
}

export function createDeleteFileTool(workspacePath: string): ToolDefinition {
  return {
    name: "delete_file",
    description:
      "Delete a file within the workspace. " +
      "Protected system files (.env, .git/config, SSH keys, etc.) cannot be deleted. " +
      "Requires user confirmation before execution.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to workspace (e.g., 'docs/README.md')",
        },
      },
      required: ["path"],
    },
    security: {
      level: "write",
    },
    async execute(params) {
      const { path: relativePath } = params as { path: string };

      const resolved = await resolveWorkspacePath(workspacePath, relativePath);
      if (!resolved) {
        if (relativePath && isProtectedPath(relativePath)) {
          return {
            success: false,
            error: `Protected file cannot be deleted: ${relativePath}`,
          };
        }
        return {
          success: false,
          error: "Invalid path: must be a relative path within the workspace",
        };
      }

      try {
        await unlink(resolved.absPath);
        log.info(`Deleted file: ${resolved.relPath}`);
        return {
          success: true,
          data: {
            path: resolved.relPath,
            deleted: true,
          },
        };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return {
            success: true,
            data: {
              path: resolved.relPath,
              deleted: false,
            },
          };
        }
        if (code === "EACCES") {
          return {
            success: false,
            error: `Permission denied: ${resolved.relPath}`,
          };
        }
        if (code === "EROFS") {
          return {
            success: false,
            error: "Read-only file system",
          };
        }
        log.error(`Error deleting file ${resolved.relPath}`, err);
        throw err;
      }
    },
  };
}

