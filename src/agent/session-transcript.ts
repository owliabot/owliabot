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
      let result = recentTurns.flat();

      // Fix: Ensure every toolResult has a matching toolCall in history.
      // After truncation, orphaned toolResults (whose assistant toolCall was
      // cut) cause "No tool call found for function call output" errors from
      // LLM providers (OpenAI/Codex). We collect all known call IDs from
      // assistant toolCalls, then strip any toolResult whose callId is missing.
      result = stripOrphanedToolMessages(result);

      return result;
    },

    async clear(sessionId: SessionId): Promise<void> {
      const path = getPath(sessionId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
      log.info(`Cleared transcript ${sessionId}`);
    },
  };
}

/**
 * Remove orphaned tool messages from a message list.
 *
 * 1. Collect all toolCall IDs emitted by assistant messages.
 * 2. For each user message that carries toolResults, keep only entries whose
 *    toolCallId exists in the collected set. Drop the message entirely if no
 *    results survive.
 * 3. Remove assistant messages whose toolCalls ALL lack a matching toolResult
 *    that follows them (dangling tail toolCalls confuse some providers).
 */
function stripOrphanedToolMessages(messages: Message[]): Message[] {
  // Pass 1 — gather all call IDs from assistant toolCalls
  const knownCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        if (tc.id) knownCallIds.add(tc.id);
      }
    }
  }

  // Pass 2 — filter toolResult messages whose callId has no matching toolCall
  const cleaned: Message[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.toolResults && m.toolResults.length > 0) {
      const validResults = m.toolResults.filter(
        (tr) => tr.toolCallId && knownCallIds.has(tr.toolCallId)
      );
      if (validResults.length === 0) {
        log.warn(
          `Dropping orphaned tool_result message (${m.toolResults.length} results, none matched a toolCall in history)`
        );
        continue; // drop entire message
      }
      if (validResults.length < m.toolResults.length) {
        log.warn(
          `Trimmed ${m.toolResults.length - validResults.length} orphaned tool_result entries`
        );
      }
      cleaned.push({ ...m, toolResults: validResults });
    } else {
      cleaned.push(m);
    }
  }

  // Pass 3 — gather all answered call IDs (toolResults present in cleaned)
  const answeredCallIds = new Set<string>();
  for (const m of cleaned) {
    if (m.toolResults) {
      for (const tr of m.toolResults) {
        if (tr.toolCallId) answeredCallIds.add(tr.toolCallId);
      }
    }
  }

  // Pass 4 — drop assistant messages whose toolCalls are ALL unanswered
  // (dangling at the tail after truncation). Keep if at least one is answered
  // or if there are no toolCalls at all.
  const final: Message[] = [];
  for (const m of cleaned) {
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const hasAnyAnswer = m.toolCalls.some(
        (tc) => tc.id && answeredCallIds.has(tc.id)
      );
      if (!hasAnyAnswer) {
        log.warn(
          `Dropping assistant message with ${m.toolCalls.length} unanswered toolCalls (no matching toolResults in history)`
        );
        // Keep the text content as a plain assistant message if it has any
        if (m.content && m.content.trim()) {
          final.push({ role: m.role, content: m.content, timestamp: m.timestamp });
        }
        continue;
      }
    }
    final.push(m);
  }

  return final;
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
