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
      log.debug(`Appended ${message.role} message to ${sessionId} (path: ${path})`);
    },

    async readAll(sessionId: SessionId): Promise<Message[]> {
      return readJsonl(getPath(sessionId));
    },

    async getHistory(sessionId: SessionId, maxTurns = 20): Promise<Message[]> {
      const path = getPath(sessionId);
      log.debug(`Reading history for session ${sessionId} from ${path}`);
      const messages = await readJsonl(path);

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
    const lines = content.split("\n").filter((line) => line.trim());
    
    if (lines.length === 0) {
      log.debug(`Transcript file ${path} exists but is empty`);
      return [];
    }
    
    const messages: Message[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        messages.push(JSON.parse(lines[i]) as Message);
      } catch (parseErr) {
        log.warn(`Failed to parse line ${i + 1} in ${path}: ${(parseErr as Error).message}`);
      }
    }
    
    log.debug(`Read ${messages.length} messages from ${path}`);
    return messages;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug(`Transcript file ${path} does not exist`);
      return [];
    }
    throw err;
  }
}
