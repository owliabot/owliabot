/**
 * Session management
 * @see design.md Section 5.6
 */

import type { ChannelId } from "../channels/interface.js";
import type { ToolCall, ToolResult } from "./tools/interface.js";

export type SessionKey = `${ChannelId}:${string}`;

export interface SessionManager {
  get(key: SessionKey): Promise<Session>;
  append(key: SessionKey, message: Message): Promise<void>;
  getHistory(key: SessionKey, maxTurns?: number): Promise<Message[]>;
  clear(key: SessionKey): Promise<void>;
  list(): Promise<SessionKey[]>;
}

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
