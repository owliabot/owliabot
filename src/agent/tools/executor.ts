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
import {
  createWriteGate,
  type WriteGateChannel,
  type WriteGateCallContext,
} from "../../security/write-gate.js";

const log = createLogger("executor");

export interface ExecutorOptions {
  registry: ToolRegistry;
  context: Omit<ToolContext, "requestConfirmation">;
  writeGateChannel?: WriteGateChannel;
  securityConfig?: {
    writeToolAllowList?: string[];
    writeToolConfirmation?: boolean;
    writeToolConfirmationTimeoutMs?: number;
  };
  workspacePath?: string;
  userId?: string;
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

  // Write / sign tools require the WriteGate permission check
  if (tool.security.level !== "read") {
    const { writeGateChannel, securityConfig, workspacePath, userId } = options;

    if (!writeGateChannel || !workspacePath) {
      log.warn(
        `Tool ${call.name} requires ${tool.security.level} level but WriteGate is not configured`,
      );
      return {
        success: false,
        error: `Tool ${call.name} requires write permission but the permission gate is not configured.`,
      };
    }

    const gate = createWriteGate(securityConfig, writeGateChannel, workspacePath);

    // Build call context from executor context
    const sessionKey = context.sessionKey;
    // target = conversation portion of sessionKey (strip channel prefix)
    const target = sessionKey.includes(":")
      ? sessionKey.slice(sessionKey.indexOf(":") + 1)
      : sessionKey;

    const gateCtx: WriteGateCallContext = {
      userId: userId ?? "unknown",
      sessionKey,
      target,
    };

    const verdict = await gate.check(call, gateCtx);
    if (!verdict.allowed) {
      log.warn(
        `WriteGate denied tool ${call.name}: ${verdict.reason}`,
      );
      return {
        success: false,
        error: `Write operation denied: ${verdict.reason}`,
      };
    }
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
