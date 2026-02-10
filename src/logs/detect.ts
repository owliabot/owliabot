/**
 * Auto-detect the best LogSource for the current environment.
 */

import type { LogSource } from "./reader.js";
import { isInsideDocker, isDockerAvailable, isContainerRunning, dockerSource } from "./docker.js";
import { resolveLogFilePath, logFileExists, fileSource } from "./file.js";

export interface DetectResult {
  source: LogSource | null;
  /** Human-readable hint when no source is available. */
  hint?: string;
}

/**
 * Determine the log source automatically.
 *
 * Priority:
 *  1. Explicit --file flag
 *  2. Inside Docker → tell user logs are already on stdout
 *  3. Docker available + container running → docker logs
 *  4. LOG_FILE env → file source
 *  5. No source found → return hint
 */
export async function detectLogSource(opts: {
  file?: string;
  container: string;
}): Promise<DetectResult> {
  // 1. Explicit file
  if (opts.file) {
    if (logFileExists(opts.file)) {
      return { source: fileSource(opts.file) };
    }
    return { source: null, hint: `Log file not found: ${opts.file}` };
  }

  // 2. Inside Docker
  if (isInsideDocker()) {
    return {
      source: null,
      hint: "You are inside the Docker container — logs are already on stdout.\n  Use `docker logs -f owliabot` from the host instead.",
    };
  }

  // 3. Docker available + container running
  if (await isDockerAvailable()) {
    if (await isContainerRunning(opts.container)) {
      return { source: dockerSource(opts.container) };
    }
  }

  // 4. LOG_FILE env
  const logFilePath = resolveLogFilePath();
  if (logFilePath && logFileExists(logFilePath)) {
    return { source: fileSource(logFilePath) };
  }

  // 5. Nothing found
  return {
    source: null,
    hint: [
      "No log source detected. Options:",
      "  • Run with Docker: docker compose up -d && owliabot logs",
      "  • Set LOG_FILE env to write logs to a file",
      "  • Use npm run dev for local development (logs go to stdout)",
    ].join("\n"),
  };
}
