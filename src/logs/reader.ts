/**
 * Core log reader — reusable streaming log module.
 *
 * Provides a single `streamLogs` async generator that works with any LogSource
 * (file, docker, arbitrary process). Filtering (level, grep) is applied here so
 * every consumer gets the same behaviour for free.
 *
 * 复用: This module is intentionally dependency-free (no CLI, no tslog import)
 * so it can be used from the CLI command, a future HTTP endpoint, or WebSocket
 * streaming without pulling in unrelated code.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, type FSWatcher } from "node:fs";
import { stat, open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { watch } from "node:fs";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LogSource =
  | { kind: "file"; path: string }
  | { kind: "docker"; container: string }
  | { kind: "process"; command: string[] };

export interface LogReaderOptions {
  /** Tail / follow mode (like `tail -f`). Default true. */
  follow: boolean;
  /** Number of initial lines to show. Default 100. */
  lines: number;
  /** Filter by log level substring (debug|info|warn|error). */
  level?: string;
  /** Plain-text substring filter (case-insensitive). */
  grep?: string;
  /** Where to read logs from. */
  source: LogSource;
}

// ---------------------------------------------------------------------------
// Filtering helpers (exported for testing)
// ---------------------------------------------------------------------------

export function matchesLevel(line: string, level: string): boolean {
  const upper = level.toUpperCase();
  return line.toUpperCase().includes(upper);
}

export function matchesGrep(line: string, pattern: string): boolean {
  return line.toLowerCase().includes(pattern.toLowerCase());
}

function applyFilters(line: string, opts: LogReaderOptions): boolean {
  if (opts.level && !matchesLevel(line, opts.level)) return false;
  if (opts.grep && !matchesGrep(line, opts.grep)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Source adapters
// ---------------------------------------------------------------------------

async function* streamFromProcess(
  command: string[],
  opts: LogReaderOptions,
): AsyncGenerator<string> {
  const [cmd, ...args] = command;
  if (!cmd) throw new Error("Empty command");

  const child: ChildProcess = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rl = createInterface({ input: child.stdout! });

  // Also forward stderr lines
  const rl2 = createInterface({ input: child.stderr! });
  rl2.on("line", (l) => rl.emit("line", l));

  try {
    for await (const line of rl) {
      if (applyFilters(line, opts)) yield line;
    }
  } finally {
    child.kill();
    rl.close();
    rl2.close();
  }
}

async function* streamFromDocker(
  container: string,
  opts: LogReaderOptions,
): AsyncGenerator<string> {
  const args = ["logs"];
  if (opts.follow) args.push("-f");
  args.push("--tail", String(opts.lines), container);

  yield* streamFromProcess(["docker", ...args], opts);
}

async function* streamFromFile(
  filePath: string,
  opts: LogReaderOptions,
): AsyncGenerator<string> {
  // Read last N lines first, then follow if requested
  const fileStat = await stat(filePath);
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream });

  // Collect all lines to get last N
  const buffer: string[] = [];
  for await (const line of rl) {
    buffer.push(line);
  }

  const startIdx = Math.max(0, buffer.length - opts.lines);
  for (let i = startIdx; i < buffer.length; i++) {
    if (applyFilters(buffer[i]!, opts)) yield buffer[i]!;
  }

  if (!opts.follow) return;

  // Follow mode: watch for changes and read new content
  let position = fileStat.size;
  let watcher: FSWatcher | undefined;

  try {
    // Use a simple polling approach via fs.watch
    const changed = (): Promise<void> =>
      new Promise((resolve) => {
        watcher = watch(filePath, { persistent: true }, () => {
          watcher?.close();
          resolve();
        });
      });

    while (true) {
      await changed();

      const fd = await open(filePath, "r");
      try {
        const newStat = await fd.stat();
        if (newStat.size <= position) {
          // File was truncated — reset
          position = 0;
        }
        const buf = Buffer.alloc(newStat.size - position);
        if (buf.length > 0) {
          await fd.read(buf, 0, buf.length, position);
          position = newStat.size;
          const lines = buf.toString("utf-8").split("\n");
          for (const line of lines) {
            if (line && applyFilters(line, opts)) yield line;
          }
        }
      } finally {
        await fd.close();
      }
    }
  } finally {
    watcher?.close();
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Stream log lines from the given source, applying optional filters.
 * This is the single reusable core that all consumers should use.
 */
export async function* streamLogs(
  options: LogReaderOptions,
): AsyncGenerator<string> {
  const { source } = options;

  switch (source.kind) {
    case "docker":
      yield* streamFromDocker(source.container, options);
      break;
    case "file":
      yield* streamFromFile(source.path, options);
      break;
    case "process":
      yield* streamFromProcess(source.command, options);
      break;
    default:
      throw new Error(`Unknown log source kind: ${(source as any).kind}`);
  }
}
