// src/gateway/agentic-loop.ts
/**
 * Agentic loop module.
 * Handles the LLM + tool execution loop for message processing.
 */

import { createLogger } from "../utils/logger.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import type { Message } from "../agent/session.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { executeToolCalls } from "../agent/tools/executor.js";
import type { ToolResult } from "../agent/tools/interface.js";
import type { WriteGateChannel } from "../security/write-gate.js";
import type { Config } from "../config/schema.js";
import type { createSessionTranscriptStore } from "../agent/session-transcript.js";

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
  /** Maximum iterations (default: 5) */
  maxIterations?: number;
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
  /** Error message if processing failed */
  error?: string;
}

/**
 * Runs the agentic loop: iteratively calls LLM and executes tool calls.
 * 
 * The loop continues until:
 * - LLM returns a response without tool calls
 * - Maximum iterations reached
 * - An error occurs
 * 
 * 每轮循环：
 * 1. 调用 LLM 获取响应
 * 2. 如果有 tool calls，执行并将结果添加到对话
 * 3. 继续下一轮直到 LLM 返回最终响应
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
  config: AgenticLoopConfig,
): Promise<AgenticLoopResult> {
  const maxIterations = config.maxIterations ?? 5;
  let iteration = 0;
  let toolCallsCount = 0;
  const newMessages: Message[] = [];

  try {
    while (iteration < maxIterations) {
      iteration++;
      log.debug(`Agentic loop iteration ${iteration}`);

      // Call LLM with tools
      const response = await callWithFailover(
        config.providers,
        conversationMessages,
        { tools: config.tools.getAll() }
      );

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          content: response.content,
          iterations: iteration,
          toolCallsCount,
          messages: newMessages,
          maxIterationsReached: false,
        };
      }

      log.info(`LLM requested ${response.toolCalls.length} tool calls`);
      toolCallsCount += response.toolCalls.length;

      // Execute tool calls
      const toolResults = await executeToolCalls(response.toolCalls, {
        registry: config.tools,
        context: {
          sessionKey: context.sessionKey,
          agentId: context.agentId,
          config: {
            memorySearch: context.memorySearchConfig,
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
      await config.transcripts.append(context.sessionId, assistantToolCallMessage);

      // Add tool results as user message
      // The runner will convert this to pi-ai's ToolResultMessage format
      const toolResultsArray = response.toolCalls.map((call) => {
        const result = toolResults.get(call.id);
        if (!result) {
          return {
            success: false,
            error: "Missing tool result",
            toolCallId: call.id,
            toolName: call.name,
          } as ToolResult;
        }
        return {
          ...result,
          toolCallId: call.id,
          toolName: call.name,
        } as ToolResult;
      });

      const toolResultMessage: Message = {
        role: "user",
        content: "", // Content is empty, tool results are in toolResults array
        timestamp: Date.now(),
        toolResults: toolResultsArray,
      };
      conversationMessages.push(toolResultMessage);
      newMessages.push(toolResultMessage);
      await config.transcripts.append(context.sessionId, toolResultMessage);
    }

    // Max iterations reached
    return {
      content: "I apologize, but I couldn't complete your request. Please try again.",
      iterations: iteration,
      toolCallsCount,
      messages: newMessages,
      maxIterationsReached: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, `Agentic loop error: ${message}`);

    // Provide user-visible hints for common errors
    let userMessage: string;
    if (message.includes("No API key found for anthropic")) {
      userMessage = "⚠️ Anthropic 未授权：请先运行 `owliabot auth setup`（或设置 `ANTHROPIC_API_KEY`），然后再试一次。";
    } else {
      userMessage = `⚠️ 处理失败：${message}`;
    }

    return {
      content: userMessage,
      iterations: iteration,
      toolCallsCount,
      messages: newMessages,
      maxIterationsReached: false,
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
  history: Message[],
): Message[] {
  return [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...history,
  ];
}
