/**
 * LLM Runner using pi-ai
 * @see design.md Section 5.5
 */

import {
  complete,
  getEnvApiKey,
  getOAuthApiKey,
  type Model,
  type Context,
  type AssistantMessage,
  type Tool,
  type Api,
  type TextContent,
  type ToolCall as PiAiToolCall,
  type ToolResultMessage,
  type UserMessage,
  type Message as PiAiMessage,
} from "@mariozechner/pi-ai";
import { createLogger } from "../utils/logger.js";
import type { Message } from "./session.js";
import type { ToolDefinition, ToolCall, ToolResult } from "./tools/interface.js";
import {
  openAICompatibleComplete,
  isOpenAICompatible,
  type OpenAICompatibleConfig,
} from "./openai-compatible.js";
import { resolveModel, type ModelConfig } from "./models.js";
import {
  loadOAuthCredentials,
  saveOAuthCredentials,
  type SupportedOAuthProvider,
} from "../auth/oauth.js";
import type { TSchema } from "@sinclair/typebox";

const log = createLogger("runner");

// Re-export for backward compatibility
export interface LLMProvider {
  id: string;
  model: string;
  apiKey: string;
  priority: number;
  baseUrl?: string;
}

export interface RunnerOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  reasoning?: "minimal" | "low" | "medium" | "high";
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  provider: string;
  model: string;
  truncated?: boolean;
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

/**
 * Resolve API key for a provider
 * Critical fix #3: Save refreshed OAuth credentials
 * @param provider - Provider ID (anthropic, openai, openai-codex)
 * @param configApiKey - Optional API key from config (loaded from secrets.yaml)
 */
async function resolveApiKey(provider: string, configApiKey?: string): Promise<string> {
  // Use config API key if provided and valid
  if (configApiKey && configApiKey !== "oauth" && configApiKey !== "env" && configApiKey !== "secrets") {
    log.debug(`Using config API key for ${provider}`);
    return configApiKey;
  }

  // Try environment variable
  const envKey = getEnvApiKey(provider);
  if (envKey) {
    log.debug(`Using env API key for ${provider}`);
    return envKey;
  }

  // Try OAuth for supported providers
  const oauthProviders: SupportedOAuthProvider[] = ["anthropic", "openai-codex"];
  if (oauthProviders.includes(provider as SupportedOAuthProvider)) {
    const oauthProvider = provider as SupportedOAuthProvider;
    const credentials = await loadOAuthCredentials(oauthProvider);
    if (credentials) {
      const result = await getOAuthApiKey(oauthProvider, { [oauthProvider]: credentials });
      if (result) {
        // Save refreshed credentials if they changed
        if (result.newCredentials !== credentials) {
          log.debug(`Saving refreshed OAuth credentials for ${oauthProvider}`);
          await saveOAuthCredentials(result.newCredentials, oauthProvider);
        }
        log.debug(`Using OAuth API key for ${oauthProvider}`);
        return result.apiKey;
      }
    }
  }

  throw new Error(
    `No API key found for ${provider}. Set ${provider.toUpperCase().replace("-", "_")}_API_KEY env var or run 'owliabot auth setup ${provider}'.`
  );
}

/**
 * Convert internal messages to pi-ai context
 * Critical fix #1: Properly handle tool results
 * Important fix #5: Track provider/model for assistant messages
 */
function toContext(
  messages: Message[],
  tools?: ToolDefinition[],
  currentModel?: Model<Api>
): Context {
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const piAiMessages: PiAiMessage[] = [];

  for (const m of chatMessages) {
    if (m.role === "user") {
      // Check if this is a tool result message (has toolResults field)
      if (m.toolResults && m.toolResults.length > 0) {
        // Convert to proper ToolResultMessage format
        for (const tr of m.toolResults) {
          const toolResultMsg: ToolResultMessage = {
            role: "toolResult",
            toolCallId: tr.toolCallId ?? "",
            toolName: tr.toolName ?? "",
            content: [
              {
                type: "text",
                text: tr.success
                  ? JSON.stringify(tr.data, null, 2)
                  : `Error: ${tr.error}`,
              },
            ],
            isError: !tr.success,
            timestamp: m.timestamp,
          };
          piAiMessages.push(toolResultMsg);
        }
      } else {
        // Regular user message
        const userMsg: UserMessage = {
          role: "user",
          content: m.content,
          timestamp: m.timestamp,
        };
        piAiMessages.push(userMsg);
      }
    } else if (m.role === "assistant") {
      // Assistant message
      const content: (TextContent | PiAiToolCall)[] = [];

      if (m.content) {
        content.push({ type: "text", text: m.content });
      }

      // Add tool calls if present
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          content.push({
            type: "toolCall",
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments as Record<string, unknown>,
          });
        }
      }

      // Use current model info if available, otherwise use defaults
      const assistantMsg: AssistantMessage = {
        role: "assistant",
        content,
        api: currentModel?.api ?? ("anthropic-messages" as Api),
        provider: currentModel?.provider ?? "anthropic",
        model: currentModel?.id ?? "",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: m.timestamp,
      };
      piAiMessages.push(assistantMsg);
    }
  }

  // Convert tool definitions to pi-ai format
  const piAiTools: Tool<TSchema>[] | undefined = tools?.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown as TSchema,
  }));

  return {
    systemPrompt: systemMessage?.content,
    messages: piAiMessages,
    tools: piAiTools,
  };
}

/**
 * Convert pi-ai response to internal format
 */
function fromAssistantMessage(msg: AssistantMessage): LLMResponse {
  const textContent = msg.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");

  const toolCalls: ToolCall[] = msg.content
    .filter((c): c is PiAiToolCall => c.type === "toolCall")
    .map((c) => ({
      id: c.id,
      name: c.name,
      arguments: c.arguments,
    }));

  return {
    content: textContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      promptTokens: msg.usage.input,
      completionTokens: msg.usage.output,
    },
    provider: msg.provider,
    model: msg.model,
    truncated: msg.stopReason === "length",
  };
}

/**
 * Call LLM with a specific model configuration
 * Supports both pi-ai providers and openai-compatible endpoints
 * Important fix #4: Handle all stopReasons
 * Important fix #6: Pass reasoning option
 */
export async function runLLM(
  modelConfig: ModelConfig,
  messages: Message[],
  options?: RunnerOptions,
  provider?: LLMProvider
): Promise<LLMResponse> {
  // Check if this is an openai-compatible provider
  if (provider && isOpenAICompatible(provider.id)) {
    if (!provider.baseUrl) {
      throw new Error(
        "openai-compatible provider requires baseUrl to be set. " +
          "Example: baseUrl: http://localhost:11434/v1"
      );
    }

    log.info(`Using OpenAI-compatible endpoint: ${provider.baseUrl}`);

    const config: OpenAICompatibleConfig = {
      baseUrl: provider.baseUrl,
      model: modelConfig.model,
      apiKey: provider.apiKey,
    };

    return openAICompatibleComplete(config, messages, options);
  }

  // Standard pi-ai path
  const model = resolveModel(modelConfig);
  const apiKey = await resolveApiKey(model.provider, modelConfig.apiKey);
  const context = toContext(messages, options?.tools, model);

  log.info(`Calling ${model.provider}/${model.id}`);

  const response = await complete(model, context, {
    apiKey,
    maxTokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature,
    reasoning: options?.reasoning,
  } as Parameters<typeof complete>[2]);

  // Handle different stop reasons
  switch (response.stopReason) {
    case "stop":
    case "toolUse":
      // Normal completion
      break;
    case "length":
      log.warn("Response truncated due to max tokens limit");
      break;
    case "aborted":
      throw new Error("Request was aborted");
    case "error":
      throw new Error(response.errorMessage ?? "LLM error");
    default:
      log.warn(`Unknown stop reason: ${response.stopReason}`);
  }

  return fromAssistantMessage(response);
}

/**
 * Call LLM with failover support (for backward compatibility)
 * Now passes provider to runLLM for openai-compatible detection
 */
export async function callWithFailover(
  providers: LLMProvider[],
  messages: Message[],
  options?: RunnerOptions
): Promise<LLMResponse> {
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  let lastError: Error | null = null;

  for (const provider of sorted) {
    try {
      log.info(`Trying provider: ${provider.id}`);
      return await runLLM(
        { provider: provider.id, model: provider.model, apiKey: provider.apiKey },
        messages,
        options,
        provider // Pass provider for openai-compatible detection
      );
    } catch (err) {
      lastError = err as Error;
      log.warn(`Provider ${provider.id} failed: ${lastError.message}`);
      // Continue to next provider
    }
  }

  throw lastError ?? new Error("All providers failed");
}
