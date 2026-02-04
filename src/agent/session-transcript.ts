/**
 * Session Transcript
 *
 * Stores per-sessionId conversation transcript as JSONL.
 *
 * This is designed to pair with SessionStore (sessionKey -> sessionId).
 * Gateway integration comes later; for now this module is standalone and tested.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { Message } from "./session.js";

const log = createLogger("session-transcript");

export type SessionId = string;

export interface SessionTranscriptOptions {
  /** Base sessions directory (default: <sessionsDir>/transcripts) */
  sessionsDir: string;
  /** Optional override path */
  transcriptsDir?: string;
}

export interface SessionTranscriptStore {
  append(sessionId: SessionId, message: Message): Promise<void>;
  readAll(sessionId: SessionId): Promise<Message[]>;
  getHistory(sessionId: SessionId, maxTurns?: number): Promise<Message[]>;
  clear(sessionId: SessionId): Promise<void>;
}

export function createSessionTranscriptStore(
  options: SessionTranscriptOptions
): SessionTranscriptStore {
  const transcriptsDir = options.transcriptsDir ?? join(options.sessionsDir, "transcripts");

  const getPath = (sessionId: SessionId) => join(transcriptsDir, `${safeFile(sessionId)}.jsonl`);

  return {
    async append(sessionId: SessionId, message: Message): Promise<void> {
      const path = getPath(sessionId);
      await mkdir(dirname(path), { recursive: true });
      const line = JSON.stringify(message) + "\n";
      await writeFile(path, line, { flag: "a" });
      log.debug(`Appended transcript message to ${sessionId}`);
    },

    async readAll(sessionId: SessionId): Promise<Message[]> {
      return readJsonl(getPath(sessionId));
    },

    async getHistory(sessionId: SessionId, maxTurns = 20): Promise<Message[]> {
      const messages = await readJsonl(getPath(sessionId));

      // Group into turns (user + assistant = 1 turn)
      const turns: Message[][] = [];
      let currentTurn: Message[] = [];

      for (const msg of messages) {
        currentTurn.push(msg);
        if (msg.role === "assistant") {
          turns.push(currentTurn);
          currentTurn = [];
        }
      }

      // Include incomplete turn
      if (currentTurn.length > 0) turns.push(currentTurn);

      const recentTurns = turns.slice(-maxTurns);
      return recentTurns.flat();
    },

    async clear(sessionId: SessionId): Promise<void> {
      const path = getPath(sessionId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
      log.info(`Cleared transcript ${sessionId}`);
    },
  };
}

function safeFile(input: string): string {
  // sessionId is usually a UUID; keep it safe for filenames.
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function readJsonl(path: string): Promise<Message[]> {
  try {
    const content = await readFile(path, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Message);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
