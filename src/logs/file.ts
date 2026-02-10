/**
 * File-based log source helpers — thin adapter over the shared reader.
 */

import { existsSync } from "node:fs";
import type { LogSource } from "./reader.js";

/** Resolve the log file path from explicit arg, env, or default location. */
export function resolveLogFilePath(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.LOG_FILE) return process.env.LOG_FILE;
  return undefined;
}

/** Does the resolved log file actually exist on disk? */
export function logFileExists(path: string): boolean {
  return existsSync(path);
}

/** Build a LogSource for a local log file. */
export function fileSource(path: string): LogSource {
  return { kind: "file", path };
}
