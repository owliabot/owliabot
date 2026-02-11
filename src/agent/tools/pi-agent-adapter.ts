/**
 * Adapter to convert OwliaBot ToolDefinition to pi-agent-core AgentTool
 * @see https://github.com/badlogic/pi-agent-core
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolDefinition, ToolContext } from "./interface.js";
import type { ToolRegistry } from "./registry.js";
import type { WriteGateChannel } from "../../security/write-gate.js";
import type { Config } from "../../config/schema.js";
import { executeToolCall } from "./executor.js";
import { createLogger } from "../../utils/logger.js";
import type { TSchema } from "@sinclair/typebox";

const log = createLogger("pi-agent-adapter");

/**
 * Type guard to validate that a JsonSchema is compatible with TSchema.
 * Both use JSON Schema Draft 7 format, so we check for basic structure.
 */
function isValidSchema(schema: unknown): schema is TSchema {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as Record<string, unknown>;
  // Must have a type field (object, string, number, etc.)
  if (!("type" in s)) return false;
  // If type is object, should have properties
  if (s.type === "object" && !("properties" in s)) {
    return false;
  }
  return true;
}

/**
 * Options for adapting tools
 */
export interface AdaptToolOptions {
  /** Tool context for execution */
  context: Omit<ToolContext, "requestConfirmation">;
  /** WriteGate channel for secure sends (optional) */
  writeGateChannel?: WriteGateChannel;
  /** Security configuration */
  securityConfig?: Config["security"];
  /** Workspace path */
  workspacePath?: string;
  /** User ID */
  userId?: string;
}

/**
 * Convert a ToolDefinition to an AgentTool compatible with pi-agent-core.
 * 
 * This adapter preserves all security checks:
 * - WriteGate confirmation
 * - Policy tier decisions
 * - Audit logging
 * - Cooldown tracking
 * 
 * @param tool - OwliaBot tool definition
 * @param registry - Tool registry for executor
 * @param options - Execution options (context, security, etc.)
 * @returns AgentTool compatible with pi-agent-core
 */
export function adaptToolForAgent(
  tool: ToolDefinition,
  registry: ToolRegistry,
  options: AdaptToolOptions
): AgentTool {
  // Validate schema structure before converting
  if (!isValidSchema(tool.parameters)) {
    throw new Error(
      `Tool ${tool.name} has invalid schema: missing 'type' field or malformed structure`
    );
  }

  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    // Safe: JsonSchema (from ToolDefinition) is structurally compatible with
    // TSchema (TypeBox). Both use JSON Schema Draft 7. Validated above.
    parameters: tool.parameters as any,

    execute: async (toolCallId, params, signal) => {
      log.debug(`Executing tool ${tool.name} via pi-agent-core adapter`);

      // Use the existing executor which handles all security checks
      const result = await executeToolCall(
        { id: toolCallId, name: tool.name, arguments: params },
        {
          registry,
          context: options.context,
          writeGateChannel: options.writeGateChannel,
          securityConfig: options.securityConfig,
          workspacePath: options.workspacePath,
          userId: options.userId,
        }
      );

      // Convert ToolResult to AgentToolResult
      const text = result.success
        ? typeof result.data === "string"
          ? result.data
          : JSON.stringify(result.data ?? "OK", null, 2)
        : `Error: ${result.error ?? "Unknown error"}`;

      return {
        content: [{ type: "text", text }],
        details: {
          success: result.success,
          toolCallId,
          error: result.error,
        },
      };
    },
  };
}

/**
 * Convert all tools from a registry to AgentTools
 * 
 * @param registry - Tool registry
 * @param options - Execution options
 * @returns Array of AgentTools
 */
export function adaptAllTools(
  registry: ToolRegistry,
  options: AdaptToolOptions
): AgentTool[] {
  const tools = registry.getAll();
  return tools.map((tool) => adaptToolForAgent(tool, registry, options));
}
