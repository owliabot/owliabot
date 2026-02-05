import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { WorkspaceFiles } from "./types.js";

const log = createLogger("workspace");

const WORKSPACE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
] as const;

export async function loadWorkspace(workspacePath: string): Promise<WorkspaceFiles> {
  log.info(`Loading workspace from ${workspacePath}`);

  const files: WorkspaceFiles = {};

  for (const filename of WORKSPACE_FILES) {
    const key = filename.replace(/\.md$/i, "").toLowerCase() as keyof WorkspaceFiles;
    const content = await readWorkspaceFile(workspacePath, filename);
    if (content) {
      files[key] = content;
    }
  }

  log.info(`Loaded ${Object.keys(files).length} workspace files`);
  return files;
}

async function readWorkspaceFile(
  workspacePath: string,
  filename: string
): Promise<string | undefined> {
  try {
    const filepath = join(workspacePath, filename);
    return await readFile(filepath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}
