/**
 * OpenAI v1 API Compatible Provider
 *
 * Supports any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, Together, Groq, etc.)
 * @see design.md Section 5.5
 */

import { createLogger } from "../utils/logger.js";
import type { Message } from "./session.js";
import type { ToolDefinition, ToolCall } from "./tools/interface.js";
import { HTTPError, TimeoutError, type LLMResponse, type RunnerOptions } from "./runner.js";

const log = createLogger("openai-compatible");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  authType?: "bearer" | "api-key" | "header" | "none";
  authHeader?: string;
  timeoutMs?: number;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIErrorResponse {
  error: {
    message: string;
    type?: string;
    code?: string | number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert internal messages to OpenAI v1 format
 */
export function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      result.push({
        role: "system",
        content: m.content,
      });
    } else if (m.role === "user") {
      // Check if this is a tool result message
      if (m.toolResults && m.toolResults.length > 0) {
        for (const tr of m.toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.toolCallId ?? "",
            content: tr.success
              ? JSON.stringify(tr.data, null, 2)
              : `Error: ${tr.error}`,
          });
        }
      } else {
        result.push({
          role: "user",
          content: m.content,
        });
      }
    } else if (m.role === "assistant") {
      const msg: OpenAIMessage = {
        role: "assistant",
        content: m.content || null,
      };

      // Add tool calls if present
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === "string"
                ? tc.arguments
                : JSON.stringify(tc.arguments),
          },
        }));
      }

      result.push(msg);
    }
  }

  return result;
}

/**
 * Convert tool definitions to OpenAI v1 format
 */
export function toOpenAITools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Convert OpenAI v1 response to internal format
 */
export function fromOpenAIResponse(
  response: OpenAIResponse,
  provider: string,
  model: string
): LLMResponse {
  const choice = response.choices[0];
  if (!choice) {
    throw new Error("No choices in OpenAI response");
  }

  const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => {
    let args: unknown;
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      args = tc.function.arguments;
    }
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    };
  });

  return {
    content: choice.message.content ?? "",
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    },
    provider,
    model: response.model || model,
    truncated: choice.finish_reason === "length",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make a request to an OpenAI-compatible chat completions endpoint
 */
export async function openAICompatibleComplete(
  config: OpenAICompatibleConfig,
  messages: Message[],
  options?: RunnerOptions
): Promise<LLMResponse> {
  const { baseUrl, model, apiKey, authType, authHeader, timeoutMs = 120_000 } = config;

  // Normalize baseUrl - remove trailing slash, ensure /chat/completions path
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const url = normalizedBaseUrl.endsWith("/chat/completions")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/chat/completions`;

  const openAIMessages = toOpenAIMessages(messages);
  const tools = toOpenAITools(options?.tools);

  const requestBody: OpenAIRequest = {
    model,
    messages: openAIMessages,
    max_tokens: options?.maxTokens ?? 4096,
    stream: false,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  if (options?.temperature !== undefined) {
    requestBody.temperature = options.temperature;
  }

  log.info(`Calling OpenAI-compatible endpoint: ${url} (model: ${model})`);
  log.debug(`Request body: ${JSON.stringify(requestBody, null, 2)}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Warn on suspicious auth configurations
  if (authType === "none" && apiKey && apiKey.trim() !== "") {
    log.warn("authType is 'none' but apiKey is set — apiKey will be ignored");
  }
  if (authType === "header" && (!authHeader || authHeader.trim() === "")) {
    log.warn("authType is 'header' but authHeader is empty");
  }

  // Add auth header if API key is provided and not empty
  if (apiKey && apiKey.trim() !== "") {
    switch (authType ?? "bearer") {
      case "bearer":
        headers["Authorization"] = `Bearer ${apiKey}`;
        break;
      case "api-key":
        headers["Authorization"] = `ApiKey ${apiKey}`;
        break;
      case "header":
        if (authHeader) headers[authHeader] = apiKey;
        break;
      case "none":
        break;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorBody = (await response.json()) as OpenAIErrorResponse;
        if (errorBody.error?.message) {
          errorMessage = `HTTP ${response.status}: ${errorBody.error.message}`;
        }
      } catch {
        // Ignore JSON parse errors, use default message
      }

      log.error(`OpenAI-compatible API error: ${errorMessage}`);
      throw new HTTPError(response.status, errorMessage);
    }

    const data = (await response.json()) as OpenAIResponse;
    log.debug(`Response: ${JSON.stringify(data, null, 2)}`);

    return fromOpenAIResponse(data, "openai-compatible", model);
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof HTTPError) {
      throw err;
    }

    if (err instanceof Error) {
      if (err.name === "AbortError") {
        log.error(`Request timeout after ${timeoutMs}ms`);
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
      }

      // Network errors
      if (
        err.message.includes("fetch") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENOTFOUND") ||
        err.message.includes("network")
      ) {
        log.error(`Network error: ${err.message}`);
        throw new Error(`Network error: ${err.message}`);
      }
    }

    throw err;
  }
}

/**
 * Check if a provider config is for openai-compatible
 */
export function isOpenAICompatible(providerId: string): boolean {
  return providerId === "openai-compatible";
}
