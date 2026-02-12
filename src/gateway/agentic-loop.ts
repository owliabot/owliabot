// src/gateway/agentic-loop.ts
/**
 * Agentic loop module using pi-agent-core.
 * Handles the LLM + tool execution loop for message processing.
 */

import { agentLoop } from "@mariozechner/pi-agent-core";
import type {
  AgentMessage,
  AgentContext,
  AgentLoopConfig,
  AgentEvent,
} from "@mariozechner/pi-agent-core";
import { createLogger } from "../utils/logger.js";
import {
  callWithFailover,
  resolveApiKey,
  type LLMProvider,
} from "../agent/runner.js";
import type { Message } from "../agent/session.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { WriteGateChannel } from "../security/write-gate.js";
import type { Config } from "../config/schema.js";
import type { createSessionTranscriptStore } from "../agent/session-transcript.js";
import { adaptAllTools } from "../agent/tools/pi-agent-adapter.js";
import { resolveModel } from "../agent/models.js";
import {
  isCliProvider,
  type ConfigWithCliBackends,
} from "../agent/cli/cli-provider.js";
import { type Message as PiAiMessage } from "@mariozechner/pi-ai";

const log = createLogger("gateway:agentic-loop");

/**
 * Context for running the agentic loop.
 */
export interface AgenticLoopContext {
  /** Session key for tool context */
  sessionKey: string;
  /** Agent identifier */
  agentId: string;
  /** Session ID for transcript storage */
  sessionId: string;
  /** User ID making the request */
  userId: string;
  /** Channel ID (telegram, discord, etc.) */
  channelId: string;
  /** Reply target for the current chat (DM userId or group/channel id) */
  chatTargetId: string;
  /** Workspace path for file operations */
  workspacePath: string;
  /** Memory search configuration */
  memorySearchConfig?: Config["memorySearch"];
  /** Security configuration for tool execution */
  securityConfig?: Config["security"];
}

/**
 * Configuration for the agentic loop.
 */
export interface AgenticLoopConfig {
  /** LLM providers for failover */
  providers: LLMProvider[];
  /** Tool registry */
  tools: ToolRegistry;
  /** WriteGate channel for secure sends (optional) */
  writeGateChannel?: WriteGateChannel;
  /** Transcript store for persisting messages */
  transcripts: ReturnType<typeof createSessionTranscriptStore>;
  /** Maximum iterations (hard safety ceiling, default: 50) */
  maxIterations?: number;
  /** Timeout in milliseconds (default: 600_000 = 10 minutes) */
  timeoutMs?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** CLI backends config for CLI provider support */
  cliBackends?: ConfigWithCliBackends;
  /** Callback to get steering messages (injected mid-run) */
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  /** Callback to get follow-up messages (processed after agent finishes) */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
}

/**
 * Result of the agentic loop execution.
 */
export interface AgenticLoopResult {
  /** Final response content */
  content: string;
  /** Number of iterations performed */
  iterations: number;
  /** Total number of tool calls made */
  toolCallsCount: number;
  /** Conversation messages (for appending to transcript) */
  messages: Message[];
  /** Whether the loop hit max iterations */
  maxIterationsReached: boolean;
  /** Whether the loop timed out */
  timedOut: boolean;
  /** Error message if processing failed */
  error?: string;
}

/**
 * Convert internal Message to AgentMessage (pi-ai compatible)
 * 
 * Runtime validation: Ensures messages have required fields before casting.
 */
function convertToLlm(messages: AgentMessage[]): PiAiMessage[] {
  const result: PiAiMessage[] = [];

  for (const msg of messages) {
    const m = msg as any;
    if (!m.role) {
      throw new Error("Message missing required 'role' field");
    }

    // Handle legacy user messages with toolResults array → convert to tool_result messages
    if (m.role === "user" && Array.isArray(m.toolResults) && m.toolResults.length > 0) {
      for (const tr of m.toolResults) {
        const text = tr.success
          ? typeof tr.data === "string"
            ? tr.data
            : JSON.stringify(tr.data ?? "OK", null, 2)
          : `Error: ${tr.error ?? "Unknown error"}`;
        result.push({
          role: "tool",
          content: [{ type: "text", text }],
          tool_use_id: tr.toolCallId,
        } as any);
      }
      continue;
    }

    if (m.role === "user" || m.role === "assistant") {
      if (!("content" in m)) {
        throw new Error(`${m.role} message missing 'content' field`);
      }
    }

    // AgentMessage is structurally compatible with pi-ai Message
    result.push(m as PiAiMessage);
  }

  return result;
}

/**
 * Runs the agentic loop using pi-agent-core agentLoop.
 * 
 * The loop continues until:
 * - LLM returns a response without tool calls
 * - Timeout reached
 * - Maximum iterations reached (via event tracking)
 * - AbortSignal triggered
 * - An error occurs
 * 
 * 每轮循环：
 * 1. 调用 LLM 获取响应
 * 2. 如果有 tool calls，执行并将结果添加到对话
 * 3. 继续下一轮直到 LLM 返回最终响应或超时
 * 
 * @param conversationMessages - Initial conversation messages (including system prompt)
 * @param context - Execution context (session, user, etc.)
 * @param config - Loop configuration (providers, tools, etc.)
 * @returns Loop execution result
 * 
 * @example
 * ```ts
 * const result = await runAgenticLoop(
 *   [{ role: 'system', content: systemPrompt }, ...history],
 *   { sessionKey, agentId, sessionId, userId, channelId, workspacePath },
 *   { providers, tools, transcripts }
 * );
 * console.log(`Response: ${result.content} (${result.iterations} iterations)`);
 * ```
 */
export async function runAgenticLoop(
  conversationMessages: Message[],
  context: AgenticLoopContext,
  config: AgenticLoopConfig
): Promise<AgenticLoopResult> {
  const maxIterations = config.maxIterations ?? 50;
  const timeoutMs = config.timeoutMs ?? 600_000; // 10 minutes default

  // Check if using CLI providers - fallback to old path
  const primaryProvider = config.providers[0];
  if (
    primaryProvider &&
    isCliProvider(primaryProvider.id, config.cliBackends)
  ) {
    log.info("Using CLI provider, falling back to callWithFailover path");
    return runLegacyLoop(conversationMessages, context, config);
  }

  let iterations = 0;
  let turnCount = 0; // Track turns locally (not from context history)
  let toolCallsCount = 0;
  let timedOut = false;
  let maxIterationsReached = false;
  let collectedMessages: AgentMessage[] = [];

  // Setup timeout
  const timeoutController = new AbortController();
  const combinedSignal = config.signal
    ? AbortSignal.any([config.signal, timeoutController.signal])
    : timeoutController.signal;

  const timeoutId = setTimeout(() => {
    log.warn("Agentic loop timeout reached");
    timeoutController.abort();
    timedOut = true;
  }, timeoutMs);

  try {
    // Extract system prompt
    const systemMessage = conversationMessages.find((m) => m.role === "system");
    const systemPrompt = systemMessage?.content || "";

    // Get chat messages (excluding system) as AgentMessages
    const chatMessages = conversationMessages.filter(
      (m) => m.role !== "system"
    ) as AgentMessage[];

    // Convert tools to AgentTool format
    const agentTools = adaptAllTools(config.tools, {
      context: {
        sessionKey: context.sessionKey,
        agentId: context.agentId,
        config: {
          memorySearch: context.memorySearchConfig,
          channel: context.channelId,
          target: context.chatTargetId,
        },
      },
      writeGateChannel: config.writeGateChannel,
      securityConfig: context.securityConfig,
      workspacePath: context.workspacePath,
      userId: context.userId,
    });

    // Sort providers by priority for failover
    const sortedProviders = [...config.providers].sort((a, b) => a.priority - b.priority);

    // Resolve primary model config (used as default; failover rotates on error)
    let currentProviderIndex = 0;
    const getCurrentProvider = () => sortedProviders[currentProviderIndex];

    const modelConfig = {
      provider: getCurrentProvider().id,
      model: getCurrentProvider().model,
      apiKey: getCurrentProvider().apiKey,
    };

    const model = resolveModel(modelConfig);

    // Setup agent context
    const agentContext: AgentContext = {
      systemPrompt,
      messages: chatMessages,
      tools: agentTools,
    };

    // Setup agent loop config (with iteration limit via transformContext)
    const loopConfig: AgentLoopConfig = {
      model,
      convertToLlm,
      getApiKey: async (provider: string) => {
        // Try current provider first, then failover to others
        for (let i = 0; i < sortedProviders.length; i++) {
          const idx = (currentProviderIndex + i) % sortedProviders.length;
          const p = sortedProviders[idx];
          try {
            const key = await resolveApiKey(p.id, p.apiKey);
            currentProviderIndex = idx; // stick with working provider
            return key;
          } catch {
            log.warn(`Provider ${p.id} key resolution failed, trying next`);
          }
        }
        // Fallback: try the requested provider name directly
        return await resolveApiKey(provider, modelConfig.apiKey);
      },
      // Inject max iterations check via transformContext (uses local turnCount)
      transformContext: async (messages: AgentMessage[]) => {
        if (turnCount >= maxIterations) {
          maxIterationsReached = true;
          throw new Error(`Max iterations (${maxIterations}) reached`);
        }
        return messages;
      },
      getSteeringMessages: config.getSteeringMessages,
      getFollowUpMessages: config.getFollowUpMessages,
    };

    // Run agent loop
    const stream = agentLoop([], agentContext, loopConfig, combinedSignal);

    // Collect events and messages
    for await (const event of stream) {
      handleAgentEvent(
        event,
        () => {
          iterations++;
          turnCount++;
        },
        () => {
          toolCallsCount++;
        }
      );

      // Collect messages from events to preserve conversation history
      // even if the loop errors out before completion
      if (event.type === "turn_end" && event.message) {
        collectedMessages.push(event.message);
      } else if (event.type === "message_end" && event.message) {
        // Update or add the message
        const existingIndex = collectedMessages.findIndex(
          (m) => m.role === event.message.role && m.timestamp === event.message.timestamp
        );
        if (existingIndex >= 0) {
          collectedMessages[existingIndex] = event.message;
        } else {
          collectedMessages.push(event.message);
        }
      } else if (event.type === "agent_end" && event.messages) {
        // Final messages from agent_end event
        collectedMessages = event.messages;
      }
    }

    // Get final messages from stream result (should match what we collected)
    const finalMessages = await stream.result();
    // Use result if available, fall back to collected messages
    collectedMessages = finalMessages.length > 0 ? finalMessages : collectedMessages;

    // Extract final content from last assistant message
    const lastMessage = finalMessages[finalMessages.length - 1];
    const extracted =
      lastMessage && lastMessage.role === "assistant"
        ? extractTextContent(lastMessage)
        : "";
    // Fallback when the LLM's last turn was tool-only (no text block)
    const finalContent =
      extracted.trim().length > 0
        ? extracted
        : "I apologize, but I couldn't complete your request.";

    return {
      content: finalContent,
      iterations,
      toolCallsCount,
      messages: finalMessages as Message[], // Convert back to internal format
      maxIterationsReached: false,
      timedOut: false,
    };
  } catch (err) {
    // Check if this was a max iterations error
    if (maxIterationsReached) {
      log.warn(`Max iterations (${maxIterations}) reached`);
      return {
        content:
          "I apologize, but I couldn't complete your request. Please try again.",
        iterations,
        toolCallsCount,
        messages: collectedMessages as Message[], // Return accumulated messages
        maxIterationsReached: true,
        timedOut: false,
      };
    }

    // Check if this was a timeout/abort
    if (combinedSignal.aborted) {
      if (timedOut) {
        log.warn("Agentic loop timed out");
        return {
          content: "⚠️ 处理超时：请求耗时过长。请简化您的请求后重试。",
          iterations,
          toolCallsCount,
          messages: collectedMessages as Message[], // Return accumulated messages
          maxIterationsReached: false,
          timedOut: true,
        };
      } else {
        log.warn("Agentic loop aborted");
        return {
          content: "⚠️ 处理已取消。",
          iterations,
          toolCallsCount,
          messages: collectedMessages as Message[], // Return accumulated messages
          maxIterationsReached: false,
          timedOut: false,
          error: "Aborted",
        };
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, `Agentic loop error: ${message}`);

    // Provide user-visible hints for common errors
    let userMessage: string;
    if (message.includes("No API key found for anthropic")) {
      userMessage =
        "⚠️ Anthropic 未授权：请先运行 `owliabot auth setup`（或设置 `ANTHROPIC_API_KEY`），然后再试一次。";
    } else {
      userMessage = `⚠️ 处理失败：${message}`;
    }

    return {
      content: userMessage,
      iterations,
      toolCallsCount,
      messages: collectedMessages as Message[], // Return accumulated messages
      maxIterationsReached: false,
      timedOut: false,
      error: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle agent events for tracking
 */
function handleAgentEvent(
  event: AgentEvent,
  onIteration: () => void,
  onToolCall: () => void
): void {
  switch (event.type) {
    case "turn_start":
      // Increment iteration count on each turn
      onIteration();
      log.debug("Agent turn started");
      break;
    case "tool_execution_start":
      onToolCall();
      const argsStr = JSON.stringify(event.args);
      log.info(
        `  ↳ ${event.toolName}(${argsStr.length > 200 ? argsStr.slice(0, 200) + "…" : argsStr})`
      );
      break;
    case "tool_execution_end":
      const resultStr =
        typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result);
      log.info(
        `  ↳ result [${event.toolCallId}]: ${resultStr.length > 300 ? resultStr.slice(0, 300) + "…" : resultStr}`
      );
      break;
  }
}

/**
 * Extract text content from an assistant message
 */
function extractTextContent(message: AgentMessage): string {
  if (message.role !== "assistant") return "";

  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * Legacy loop implementation for CLI providers.
 * Uses the original callWithFailover approach.
 */
async function runLegacyLoop(
  conversationMessages: Message[],
  context: AgenticLoopContext,
  config: AgenticLoopConfig
): Promise<AgenticLoopResult> {
  const { executeToolCalls } = await import("../agent/tools/executor.js");

  const maxIterations = config.maxIterations ?? 5;
  let iteration = 0;
  let toolCallsCount = 0;
  const newMessages: Message[] = [];

  try {
    while (iteration < maxIterations) {
      iteration++;
      log.debug(`Legacy agentic loop iteration ${iteration}`);

      // Call LLM with tools
      const response = await callWithFailover(
        config.providers,
        conversationMessages,
        { tools: config.tools.getAll() },
        config.cliBackends
      );

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          content: response.content,
          iterations: iteration,
          toolCallsCount,
          messages: newMessages,
          maxIterationsReached: false,
          timedOut: false,
        };
      }

      log.info(`LLM requested ${response.toolCalls.length} tool calls`);
      toolCallsCount += response.toolCalls.length;

      // Execute tool calls using existing executor
      const toolResults = await executeToolCalls(response.toolCalls, {
        registry: config.tools,
        context: {
          sessionKey: context.sessionKey,
          agentId: context.agentId,
          config: {
            memorySearch: context.memorySearchConfig,
            channel: context.channelId,
            target: context.chatTargetId,
          },
        },
        writeGateChannel: config.writeGateChannel,
        securityConfig: context.securityConfig,
        workspacePath: context.workspacePath,
        userId: context.userId,
      });

      // Add assistant message with tool calls to conversation
      const assistantToolCallMessage: Message = {
        role: "assistant",
        content: response.content || "",
        timestamp: Date.now(),
        toolCalls: response.toolCalls,
      };
      conversationMessages.push(assistantToolCallMessage);
      newMessages.push(assistantToolCallMessage);
      await config.transcripts.append(
        context.sessionId,
        assistantToolCallMessage
      );

      // Add tool results as user message
      const toolResultsArray = response.toolCalls.map((call) => {
        const result = toolResults.get(call.id);
        if (!result) {
          return {
            success: false,
            error: "Missing tool result",
            toolCallId: call.id,
            toolName: call.name,
          };
        }
        return {
          ...result,
          toolCallId: call.id,
          toolName: call.name,
        };
      });

      const toolResultMessage: Message = {
        role: "user",
        content: "",
        timestamp: Date.now(),
        toolResults: toolResultsArray,
      };
      conversationMessages.push(toolResultMessage);
      newMessages.push(toolResultMessage);
      await config.transcripts.append(context.sessionId, toolResultMessage);
    }

    // Max iterations reached
    return {
      content:
        "I apologize, but I couldn't complete your request. Please try again.",
      iterations: iteration,
      toolCallsCount,
      messages: newMessages,
      maxIterationsReached: true,
      timedOut: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, `Legacy agentic loop error: ${message}`);

    let userMessage: string;
    if (message.includes("No API key found for anthropic")) {
      userMessage =
        "⚠️ Anthropic 未授权：请先运行 `owliabot auth setup`（或设置 `ANTHROPIC_API_KEY`），然后再试一次。";
    } else {
      userMessage = `⚠️ 处理失败：${message}`;
    }

    return {
      content: userMessage,
      iterations: iteration,
      toolCallsCount,
      messages: newMessages,
      maxIterationsReached: false,
      timedOut: false,
      error: message,
    };
  }
}

/**
 * Creates a fresh conversation with system prompt and history.
 * 
 * @param systemPrompt - System prompt content
 * @param history - Previous conversation history
 * @returns Conversation messages array
 */
export function createConversation(
  systemPrompt: string,
  history: Message[]
): Message[] {
  return [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...history,
  ];
}
