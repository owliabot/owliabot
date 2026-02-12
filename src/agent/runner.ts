/**
 * LLM Runner using pi-ai
 * @see design.md Section 5.5
 */

import {
  completeSimple,
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
import { resolveModel, getContextWindow, type ModelConfig } from "./models.js";
import {
  guardContext,
  truncateToolResult,
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  DEFAULT_RESERVE_TOKENS,
} from "./context-guard.js";
import { isCliProvider, parseCliModelString, type ConfigWithCliBackends } from "./cli/cli-provider.js";
import { runCliAgent, type CliAgentResult } from "./cli/cli-runner.js";
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
  apiKey?: string;
  priority: number;
  baseUrl?: string;
}

export interface RunnerOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  reasoning?: "minimal" | "low" | "medium" | "high";
  contextGuard?: {
    enabled?: boolean;
    maxToolResultChars?: number;
    reserveTokens?: number;
    truncateHeadChars?: number;
    truncateTailChars?: number;
    contextWindowOverride?: number;
  };
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

  // Try OAuth for supported providers (only openai-codex now; anthropic uses setup-token)
  const oauthProviders: SupportedOAuthProvider[] = ["openai-codex"];
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

  // Build helpful error message based on provider
  const envVar = provider.toUpperCase().replace("-", "_") + "_API_KEY";
  if (provider === "anthropic") {
    throw new Error(
      `No API key found for ${provider}. Run 'claude setup-token' and paste the token during onboarding, or set ${envVar} env var.`
    );
  }
  throw new Error(
    `No API key found for ${provider}. Set ${envVar} env var or run 'owliabot auth setup ${provider}'.`
  );
}

/** Options for toContext L1 safety net truncation */
interface ToContextOptions {
  maxToolResultChars?: number;
  truncateHeadChars?: number;
  truncateTailChars?: number;
}

/**
 * Convert internal messages to pi-ai context
 * Critical fix #1: Properly handle tool results
 * Important fix #5: Track provider/model for assistant messages
 */
function toContext(
  messages: Message[],
  tools?: ToolDefinition[],
  currentModel?: Model<Api>,
  truncateOptions?: ToContextOptions,
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
          const rawText = tr.success
            ? JSON.stringify(tr.data, null, 2)
            : `Error: ${tr.error}`;
          // L1 safety net: truncate oversized tool results
          const resultText = truncateToolResult(
            rawText,
            truncateOptions?.maxToolResultChars ?? DEFAULT_TOOL_RESULT_MAX_CHARS,
            truncateOptions?.truncateHeadChars,
            truncateOptions?.truncateTailChars,
          );
          const toolResultMsg: ToolResultMessage = {
            role: "toolResult",
            toolCallId: tr.toolCallId ?? "",
            toolName: tr.toolName ?? "",
            content: [
              {
                type: "text",
                text: resultText,
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
 * Check if an error is a context window overflow error
 */
function isContextOverflowError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("context_length_exceeded") ||
    msg.includes("prompt is too long") ||
    msg.includes("maximum context length") ||
    msg.includes("request too large") ||
    msg.includes("token limit")
  );
}

/**
 * Call LLM with a specific model configuration
 * Supports both pi-ai providers and openai-compatible endpoints
 * Important fix #4: Handle all stopReasons
 * Important fix #6: Pass reasoning option
 * Enhancement: Auto-retry on context overflow with more aggressive pruning
 */
export async function runLLM(
  modelConfig: ModelConfig,
  messages: Message[],
  options?: RunnerOptions,
  provider?: LLMProvider,
  _retryCount: number = 0,
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

    // Apply context guard to openai-compatible path too
    const guardConfig = options?.contextGuard;
    const contextWindow = guardConfig?.contextWindowOverride ?? getContextWindow(modelConfig);
    const { messages: guardedMessages } = guardContext(messages, {
      contextWindow,
      reserveTokens: guardConfig?.reserveTokens ?? options?.maxTokens ?? DEFAULT_RESERVE_TOKENS,
      maxToolResultChars: guardConfig?.maxToolResultChars,
      truncateHeadChars: guardConfig?.truncateHeadChars,
      truncateTailChars: guardConfig?.truncateTailChars,
    });

    const config: OpenAICompatibleConfig = {
      baseUrl: provider.baseUrl,
      model: modelConfig.model,
      apiKey: provider.apiKey,
    };

    return openAICompatibleComplete(config, guardedMessages, options);
  }

  // Standard pi-ai path
  const model = resolveModel(modelConfig);
  const apiKey = await resolveApiKey(model.provider, modelConfig.apiKey);

  // L2: Context window guard — prune history if needed
  const guardConfig = options?.contextGuard;
  const guardEnabled = guardConfig?.enabled !== false; // enabled by default
  const baseContextWindow = guardConfig?.contextWindowOverride ?? getContextWindow(modelConfig);
  
  // Apply more aggressive limits on retry (both context window and tool result chars)
  const retryMultiplier = _retryCount === 0 ? 1.0 : _retryCount === 1 ? 0.8 : 0.6;
  const effectiveContextWindow = Math.floor(baseContextWindow * retryMultiplier);
  const effectiveMaxToolResultChars = guardConfig?.maxToolResultChars 
    ? Math.floor(guardConfig.maxToolResultChars * retryMultiplier)
    : undefined;
  
  const { messages: guardedMessages, dropped } = guardEnabled
    ? guardContext(messages, {
        contextWindow: effectiveContextWindow,
        reserveTokens: guardConfig?.reserveTokens ?? options?.maxTokens ?? DEFAULT_RESERVE_TOKENS,
        maxToolResultChars: effectiveMaxToolResultChars,
        truncateHeadChars: guardConfig?.truncateHeadChars,
        truncateTailChars: guardConfig?.truncateTailChars,
      })
    : { messages, dropped: 0 };

  // Skip double truncation: guardContext already handled truncation, so pass Infinity to toContext
  const context = toContext(guardedMessages, options?.tools, model, {
    maxToolResultChars: Infinity,
    truncateHeadChars: guardConfig?.truncateHeadChars,
    truncateTailChars: guardConfig?.truncateTailChars,
  });

  log.info(`Calling ${model.provider}/${model.id}${_retryCount > 0 ? ` (retry ${_retryCount})` : ""}`);

  try {
    const response = await completeSimple(model, context, {
      apiKey,
      maxTokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature,
      reasoning: options?.reasoning,
    } as Parameters<typeof completeSimple>[2]);

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
  } catch (error) {
    // Retry on context overflow (max 2 retries)
    if (isContextOverflowError(error) && _retryCount < 2) {
      log.warn(
        `Context overflow detected, retrying with more aggressive pruning (attempt ${_retryCount + 1}/2)`
      );
      return runLLM(modelConfig, messages, options, provider, _retryCount + 1);
    }
    throw error;
  }
}

/**
 * Call LLM with failover support (for backward compatibility)
 * Now passes provider to runLLM for openai-compatible detection
 * Also supports CLI providers (claude-cli, codex-cli)
 */
export async function callWithFailover(
  providers: LLMProvider[],
  messages: Message[],
  options?: RunnerOptions,
  config?: ConfigWithCliBackends,
  cliContext?: {
    sessionId?: string;
    workdir?: string;
  }
): Promise<LLMResponse> {
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  let lastError: Error | null = null;

  for (const provider of sorted) {
    try {
      log.info(`Trying provider: ${provider.id}`);

      // Check if this is a CLI provider
      if (isCliProvider(provider.id, config)) {
        log.info(`Using CLI provider: ${provider.id}`);
        return await runCliAgentWrapper(provider, messages, config, cliContext);
      }

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

// CLI session ID storage (in-memory, keyed by internal session key)
const cliSessionMap = new Map<string, string>();

/**
 * Get stored CLI session ID for an internal session key
 */
export function getCliSessionId(internalKey: string): string | undefined {
  return cliSessionMap.get(internalKey);
}

/**
 * Store CLI session ID for an internal session key
 */
export function setCliSessionId(internalKey: string, cliSessionId: string): void {
  cliSessionMap.set(internalKey, cliSessionId);
}

/**
 * Run a CLI agent and convert result to LLMResponse format
 */
async function runCliAgentWrapper(
  provider: LLMProvider,
  messages: Message[],
  config?: ConfigWithCliBackends,
  cliContext?: {
    sessionId?: string;
    workdir?: string;
  }
): Promise<LLMResponse> {
  // Extract the latest user message as the prompt
  const userMessages = messages.filter((m) => m.role === "user" && !m.toolResults);
  const latestMessage = userMessages[userMessages.length - 1];
  if (!latestMessage) {
    throw new Error("No user message found for CLI agent");
  }

  // Build system prompt from system messages
  const systemMessages = messages.filter((m) => m.role === "system");
  const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

  // Determine if this is the first message
  const isFirstMessage = !cliContext?.sessionId;

  // Run the CLI agent
  const result = await runCliAgent({
    provider: provider.id,
    model: provider.model,
    prompt: latestMessage.content,
    systemPrompt: systemPrompt || undefined,
    sessionId: cliContext?.sessionId,
    isFirstMessage,
    workdir: cliContext?.workdir ?? process.cwd(),
    timeoutMs: 120_000,
    config,
  });

  // Convert CLI result to LLMResponse
  const response: LLMResponse = {
    content: result.text,
    toolCalls: undefined, // CLI handles tools internally
    usage: {
      promptTokens: 0, // CLI doesn't report usage
      completionTokens: 0,
    },
    provider: provider.id,
    model: provider.model,
  };

  // Attach session ID to response for caller to track
  if (result.sessionId) {
    (response as LLMResponse & { cliSessionId?: string }).cliSessionId = result.sessionId;
  }

  return response;
}
