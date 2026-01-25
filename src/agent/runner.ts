/**
 * LLM Runner with failover
 * @see design.md Section 5.5
 */

import { createLogger } from "../utils/logger.js";
import type { Message } from "./session.js";
import type { ToolDefinition, ToolCall } from "./tools/interface.js";
import { providerRegistry } from "./providers/index.js";

const log = createLogger("runner");

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

export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string
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

export async function callWithFailover(
  providers: LLMProvider[],
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  let lastError: Error | null = null;

  for (const provider of sorted) {
    try {
      log.info(`Trying provider: ${provider.id}`);
      return await callProvider(provider, messages, options);
    } catch (err) {
      lastError = err as Error;
      if (isRetryable(err)) {
        log.warn(
          `Provider ${provider.id} failed with retryable error, trying next...`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("All providers failed");
}

async function callProvider(
  provider: LLMProvider,
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  const callFn = providerRegistry.get(provider.id);

  if (!callFn) {
    throw new Error(
      `Unknown provider: ${provider.id}. Available: ${providerRegistry.list().join(", ")}`
    );
  }

  return callFn(provider, messages, options);
}
