/**
 * LLM Runner with failover
 * @see design.md Section 5.5
 */

import type { Message } from "./session.js";
import type { ToolDefinition, ToolCall } from "./tools/interface.js";

export interface LLMProvider {
  id: string;
  model: string;
  apiKey: string;
  priority: number;
  baseUrl?: string;
}

export interface LLMRunner {
  call(messages: Message[], options?: CallOptions): Promise<LLMResponse>;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  provider: string;
}

// Error types for failover logic
export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HTTPError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HTTPError) {
    return [429, 500, 502, 503, 504].includes(err.status);
  }
  if (err instanceof TimeoutError) {
    return true;
  }
  return false;
}
