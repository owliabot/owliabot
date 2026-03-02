/**
 * Session management
 * @see design.md Section 5.6
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { ChannelId } from "../channels/interface.js";
import type { ToolCall, ToolResult } from "./tools/interface.js";

const log = createLogger("session");

export type SessionKey = `${ChannelId}:${string}`;

export interface Session {
  key: SessionKey;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/** Standalone tool result message produced by pi-agent-core / agentic-loop */
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text: string }>;
  isError: boolean;
  timestamp: number;
}

/** Any message that can appear in a session transcript (persisted JSONL) */
export type AnyMessage = Message | ToolResultMessage;

/**
 * Drop orphaned tool result messages from the start of a history array.
 *
 * After turn-based truncation, the history may start with:
 *   - A user message containing a legacy toolResults[] array, or
 *   - A standalone role="toolResult" message (pi-agent-core format)
 * Both indicate the matching assistant+toolCalls message was truncated.
 * LLM APIs reject tool results without a preceding tool call.
 */
export function dropOrphanedToolResults(
  messages: AnyMessage[],
  logger: { warn: (msg: string) => void }
): AnyMessage[] {
  let result = messages;
  while (result.length > 0) {
    const first = result[0];
    const isToolResult =
      (first as ToolResultMessage).role === "toolResult" ||
      ((first as Message).toolResults && (first as Message).toolResults!.length > 0);
    if (!isToolResult) break;
    logger.warn("Dropping orphaned tool result message (no matching tool call in history)");
    result = result.slice(1);
  }
  return result;
}

export interface SessionManager {
  get(key: SessionKey): Promise<Session>;
  append(key: SessionKey, message: Message): Promise<void>;
  getHistory(key: SessionKey, maxTurns?: number): Promise<Message[]>;
  clear(key: SessionKey): Promise<void>;
  list(): Promise<SessionKey[]>;
}

export function createSessionManager(sessionsDir: string): SessionManager {
  const getSessionPath = (key: SessionKey) =>
    join(sessionsDir, `${key.replace(":", "_")}.jsonl`);

  return {
    async get(key: SessionKey): Promise<Session> {
      const messages = await readSessionFile(getSessionPath(key));
      const now = Date.now();

      return {
        key,
        createdAt: messages[0]?.timestamp ?? now,
        lastActiveAt: messages[messages.length - 1]?.timestamp ?? now,
        messageCount: messages.length,
      };
    },

    async append(key: SessionKey, message: Message): Promise<void> {
      const path = getSessionPath(key);
      await mkdir(dirname(path), { recursive: true });

      const line = JSON.stringify(message) + "\n";
      await writeFile(path, line, { flag: "a" });

      log.debug(`Appended message to ${key}`);
    },

    async getHistory(key: SessionKey, maxTurns = 20): Promise<Message[]> {
      const messages = await readSessionFile(getSessionPath(key));

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
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }

      // Take last N turns
      const recentTurns = turns.slice(-maxTurns);
      let result = recentTurns.flat();

      // Drop orphaned tool results whose matching assistant+toolCalls was truncated.
      result = dropOrphanedToolResults(result as AnyMessage[], log) as Message[];

      return result;
    },

    async clear(key: SessionKey): Promise<void> {
      const path = getSessionPath(key);
      await writeFile(path, "");
      log.info(`Cleared session ${key}`);
    },

    async list(): Promise<SessionKey[]> {
      try {
        const files = await readdir(sessionsDir);
        return files
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => f.replace(".jsonl", "").replace("_", ":") as SessionKey);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw err;
      }
    },
  };
}

async function readSessionFile(path: string): Promise<Message[]> {
  try {
    const content = await readFile(path, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Message);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
