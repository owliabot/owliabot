/**
 * Tool executor - runs tools and returns results
 * @see design.md Section 5.2
 */

import { createLogger } from "../../utils/logger.js";
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
} from "./interface.js";
import type { ToolRegistry } from "./registry.js";

const log = createLogger("executor");

export interface ExecutorOptions {
  registry: ToolRegistry;
  context: Omit<ToolContext, "requestConfirmation">;
}

export async function executeToolCall(
  call: ToolCall,
  options: ExecutorOptions
): Promise<ToolResult> {
  const { registry, context } = options;

  const tool = registry.get(call.name);
  if (!tool) {
    log.error(`Unknown tool: ${call.name}`);
    return {
      success: false,
      error: `Unknown tool: ${call.name}`,
    };
  }

  // MVP: Only allow read-level tools without confirmation
  if (tool.security.level !== "read") {
    log.warn(`Tool ${call.name} requires ${tool.security.level} level, skipping`);
    return {
      success: false,
      error: `Tool ${call.name} requires confirmation (not implemented in MVP)`,
    };
  }

  try {
    log.info(`Executing tool: ${call.name}`);
    const result = await tool.execute(call.arguments, {
      ...context,
      requestConfirmation: async () => false, // MVP: no confirmation flow
    });
    log.info(`Tool ${call.name} completed: ${result.success}`);
    return result;
  } catch (err) {
    log.error(`Tool ${call.name} failed`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function executeToolCalls(
  calls: ToolCall[],
  options: ExecutorOptions
): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>();

  for (const call of calls) {
    const result = await executeToolCall(call, options);
    results.set(call.id, result);
  }

  return results;
}
