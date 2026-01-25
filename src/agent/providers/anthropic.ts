// src/agent/providers/anthropic.ts
/**
 * Anthropic provider
 * @see design.md Section 5.5
 */

import { createLogger } from "../../utils/logger.js";
import type { Message } from "../session.js";
import type { LLMResponse, CallOptions } from "../runner.js";
import type { ToolCall } from "../tools/interface.js";
import { HTTPError } from "../runner.js";

const log = createLogger("anthropic");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

export async function callAnthropic(
  config: AnthropicConfig,
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  log.debug(`Calling Anthropic ${config.model}`);

  // Convert messages to Anthropic format
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemMessage = messages.find((m) => m.role === "system");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: options?.maxTokens ?? 4096,
    system: systemMessage?.content,
    messages: anthropicMessages,
  };

  // Add tools if provided
  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error(`Anthropic error: ${response.status} ${text}`);
    throw new HTTPError(response.status, text);
  }

  const data = (await response.json()) as AnthropicResponse;

  // Extract text content
  const content = data.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  // Extract tool calls
  const toolCalls: ToolCall[] = data.content
    .filter(
      (c): c is { type: "tool_use"; id: string; name: string; input: unknown } =>
        c.type === "tool_use"
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      arguments: c.input,
    }));

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    },
    provider: "anthropic",
  };
}

interface AnthropicResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string;
}

// Register provider
import { providerRegistry } from "./registry.js";

providerRegistry.register("anthropic", async (config, messages, options) => {
  return callAnthropic(
    { apiKey: config.apiKey, model: config.model },
    messages,
    options
  );
});
