/**
 * Logger utility
 */

import { Logger } from "tslog";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ILogObj } from "tslog";

/** Optional file transport: if LOG_FILE is set, also append formatted lines. */
function buildAttachedTransports(): ((logObj: ILogObj) => void)[] {
  const logFile = process.env.LOG_FILE;
  if (!logFile) return [];

  // Ensure parent directory exists
  try {
    mkdirSync(dirname(logFile), { recursive: true });
  } catch {
    // ignore
  }

  return [
    (logObj: ILogObj) => {
      try {
        const meta = logObj as Record<string, unknown>;
        // Build a simple one-line representation
        const ts =
          typeof meta["_meta"] === "object" && meta["_meta"] !== null
            ? (meta["_meta"] as Record<string, unknown>)["date"] ?? new Date().toISOString()
            : new Date().toISOString();
        const parts = Object.values(logObj).filter(
          (v) => typeof v === "string" || typeof v === "number",
        );
        appendFileSync(logFile, `${ts} ${parts.join(" ")}\n`);
      } catch {
        // Swallow write errors to avoid recursive logging
      }
    },
  ];
}

export const logger = new Logger({
  name: "owliabot",
  minLevel: process.env.LOG_LEVEL === "debug" ? 2 : 3, // debug=2, info=3
  prettyLogTemplate:
    "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{name}}] ",
  attachedTransports: buildAttachedTransports(),
});

export function createLogger(name: string) {
  return logger.getSubLogger({ name });
}
