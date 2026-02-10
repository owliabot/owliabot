/**
 * BOOT.md — one-shot startup execution.
 *
 * Each time the gateway starts, if workspace/BOOT.md exists and is non-empty,
 * its content is fed to the agent as a prompt and executed once.
 *
 * Modeled after OpenClaw's boot.ts.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("gateway.boot");
const BOOT_FILENAME = "BOOT.md";
const SILENT_REPLY = "NO_REPLY";

export type BootRunResult =
  | { status: "skipped"; reason: "missing" | "empty" }
  | { status: "ran" }
  | { status: "failed"; reason: string };

function buildBootPrompt(content: string): string {
  return [
    "You are running a boot check. Follow BOOT.md instructions exactly.",
    "",
    "BOOT.md:",
    content,
    "",
    "If BOOT.md asks you to send a message, use the message tool (action=send with channel + target).",
    `After completing, reply with ONLY: ${SILENT_REPLY}.`,
    `If nothing needs attention, reply with ONLY: ${SILENT_REPLY}.`,
  ].join("\n");
}

async function loadBootFile(
  workspacePath: string,
): Promise<{ content?: string; status: "ok" | "missing" | "empty" }> {
  const bootPath = join(workspacePath, BOOT_FILENAME);
  try {
    const content = await readFile(bootPath, "utf-8");
    const trimmed = content.trim();
    // Ignore files that are only comments (lines starting with #) or empty
    const meaningful = trimmed
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    if (meaningful.length === 0) {
      return { status: "empty" };
    }
    return { status: "ok", content: trimmed };
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      return { status: "missing" };
    }
    throw err;
  }
}

export interface BootRunOptions {
  workspacePath: string;
  /**
   * Callback to execute the boot prompt through the agent.
   * The gateway provides this so boot.ts doesn't depend on agent internals.
   */
  executePrompt: (prompt: string) => Promise<string>;
}

export async function runBootOnce(options: BootRunOptions): Promise<BootRunResult> {
  let result: Awaited<ReturnType<typeof loadBootFile>>;
  try {
    result = await loadBootFile(options.workspacePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`boot: failed to read ${BOOT_FILENAME}: ${message}`);
    return { status: "failed", reason: message };
  }

  if (result.status === "missing") {
    log.debug("boot: BOOT.md not found, skipping");
    return { status: "skipped", reason: "missing" };
  }
  if (result.status === "empty") {
    log.debug("boot: BOOT.md is empty/comments-only, skipping");
    return { status: "skipped", reason: "empty" };
  }

  const prompt = buildBootPrompt(result.content!);
  try {
    await options.executePrompt(prompt);
    log.info("boot: BOOT.md executed successfully");
    return { status: "ran" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`boot: agent run failed: ${message}`);
    return { status: "failed", reason: message };
  }
}
