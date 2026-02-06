/**
 * MCP Tool Adapter
 * Translates MCP tools to OwliaBot ToolDefinition format
 */

import { createLogger } from "../utils/logger.js";
import type { MCPClient } from "./client.js";
import type {
  MCPToolDefinition,
  MCPSecurityOverride,
  MCPSchemaProperty,
  ToolCallResult,
  ToolResultContent,
} from "./types.js";
import type {
  ToolDefinition,
  ToolSecurity,
  ToolContext,
  ToolResult,
  JsonSchema,
  JsonSchemaProperty,
} from "../agent/tools/interface.js";

const log = createLogger("mcp:adapter");

// ============================================================================
// Types
// ============================================================================

export interface MCPToolAdapterOptions {
  /** MCP client to delegate calls to */
  client: MCPClient;
  
  /** Security level overrides for specific tools */
  securityOverrides?: Record<string, MCPSecurityOverride>;
  
  /** Default timeout for tool calls (ms) */
  timeout?: number;
}

// ============================================================================
// Adapter
// ============================================================================

/**
 * Adapts MCP tools from an MCP server to OwliaBot ToolDefinitions
 */
export class MCPToolAdapter {
  private client: MCPClient;
  private securityOverrides: Record<string, MCPSecurityOverride>;
  private timeout: number;
  private toolsCache: ToolDefinition[] | null = null;

  constructor(options: MCPToolAdapterOptions) {
    this.client = options.client;
    this.securityOverrides = options.securityOverrides ?? {};
    this.timeout = options.timeout ?? 30000;
    this.client.onToolsChanged(() => this.invalidateCache());
  }

  /**
   * Get OwliaBot-compatible tool definitions from the MCP server
   */
  async getTools(): Promise<ToolDefinition[]> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    const mcpTools = await this.client.listTools();
    const tools = mcpTools.map((tool) => this.adaptTool(tool));

    this.toolsCache = tools;
    log.info(`Adapted ${tools.length} tools from MCP server ${this.client.name}`);

    return tools;
  }

  /**
   * Invalidate cached tools (e.g., when server reports tools changed)
   */
  invalidateCache(): void {
    this.toolsCache = null;
  }

  /**
   * Get cached tools synchronously (returns empty array if not cached)
   * Use getTools() for async loading with cache population.
   */
  getCachedTools(): ToolDefinition[] {
    return this.toolsCache ?? [];
  }

  /**
   * Check if tools are cached
   */
  hasCache(): boolean {
    return this.toolsCache !== null;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Convert a single MCP tool to OwliaBot format
   */
  private adaptTool(mcpTool: MCPToolDefinition): ToolDefinition {
    // Tool name format: {server-name}__{tool-name}
    const fullName = `${this.client.name}__${mcpTool.name}`;

    return {
      name: fullName,
      description: mcpTool.description ?? `Tool from MCP server: ${mcpTool.name}`,
      parameters: this.adaptParameters(mcpTool.inputSchema),
      security: this.getSecurityConfig(fullName, mcpTool.name),
      execute: this.createExecutor(mcpTool.name),
    };
  }

  /**
   * Convert MCP input schema to OwliaBot JSON Schema format
   */
  private adaptParameters(inputSchema: MCPToolDefinition["inputSchema"]): JsonSchema {
    const properties: Record<string, JsonSchemaProperty> = {};

    if (inputSchema.properties) {
      for (const [name, prop] of Object.entries(inputSchema.properties)) {
        properties[name] = this.adaptProperty(prop);
      }
    }

    return {
      type: "object",
      properties,
      required: inputSchema.required,
    };
  }

  /**
   * Convert a single schema property
   */
  private adaptProperty(prop: MCPSchemaProperty): JsonSchemaProperty {
    const result: JsonSchemaProperty = {
      type: this.normalizeType(prop.type),
      description: prop.description,
    };

    if (prop.enum) {
      result.enum = prop.enum;
    }

    if (prop.items) {
      result.items = this.adaptProperty(prop.items);
    }

    return result;
  }

  /**
   * Normalize type string to OwliaBot supported types
   */
  private normalizeType(
    type: string
  ): "string" | "number" | "boolean" | "array" | "object" {
    const normalized = type.toLowerCase();
    switch (normalized) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return "array";
      case "object":
      default:
        return "object";
    }
  }

  /**
   * Get security configuration for a tool
   */
  private getSecurityConfig(
    fullName: string,
    originalName: string
  ): ToolSecurity {
    // Check for explicit override
    const override = this.securityOverrides[fullName];
    if (override) {
      return {
        level: override.level,
        confirmRequired: override.confirmRequired,
      };
    }

    // Apply heuristic defaults based on tool name patterns
    const lowerName = originalName.toLowerCase();
    
    // Tools that are likely read-only
    const readPrefixes = [
      "read", "get", "list", "search", "fetch", "query", "check",
      "status", "health", "describe",
    ];

    // Tools that likely modify state
    const writePrefixes = [
      "write", "create", "delete", "remove", "update", "set",
      "click", "type", "fill", "submit", "navigate", "upload",
      "send", "post", "put", "patch",
      "execute", "exec", "run", "eval", "drop", "truncate", "modify", "insert",
    ];

    for (const prefix of writePrefixes) {
      if (lowerName.includes(prefix)) {
        return { level: "write" };
      }
    }

    for (const prefix of readPrefixes) {
      if (lowerName.includes(prefix)) {
        return { level: "read" };
      }
    }

    // Default to write for unknown tools (safer default)
    return { level: "write" };
  }

  /**
   * Create the execute function for a tool
   */
  private createExecutor(
    toolName: string
  ): ToolDefinition["execute"] {
    const client = this.client;
    const timeout = this.timeout;
    const serverName = client.name;

    return async (params: unknown, _ctx: ToolContext): Promise<ToolResult> => {
      const args = (params as Record<string, unknown>) ?? {};

      try {
        // Execute with timeout
        const result = await withTimeout(
          client.callTool(toolName, args),
          timeout,
          `Tool ${serverName}__${toolName} timeout (${timeout}ms)`
        );

        // Convert MCP result to OwliaBot format
        return convertToolResult(result);
      } catch (err) {
        log.error(`Tool execution failed: ${serverName}__${toolName}`, err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert MCP tool result to OwliaBot ToolResult
 */
function convertToolResult(mcpResult: ToolCallResult): ToolResult {
  // Extract text content
  const textParts: string[] = [];
  const data: Record<string, unknown> = {};

  // Handle null/undefined content array
  if (!mcpResult.content) {
    return {
      success: !mcpResult.isError,
      data: undefined,
      error: mcpResult.isError ? "Tool returned no content" : undefined,
    };
  }

  for (const content of mcpResult.content) {
    switch (content.type) {
      case "text":
        textParts.push(content.text);
        break;
      case "image":
        // Store image data for potential use
        if (!data.images) data.images = [];
        (data.images as unknown[]).push({
          data: content.data,
          mimeType: content.mimeType,
        });
        break;
      case "resource":
        // Store resource references
        if (!data.resources) data.resources = [];
        (data.resources as unknown[]).push(content.resource);
        break;
    }
  }

  if (mcpResult.isError) {
    return {
      success: false,
      error: textParts.join("\n") || "Tool execution failed",
      data: Object.keys(data).length > 0 ? data : undefined,
    };
  }

  // Combine text output with any additional data
  const resultData = Object.keys(data).length > 0
    ? { text: textParts.join("\n"), ...data }
    : textParts.length > 0
      ? textParts.join("\n")
      : undefined;

  return {
    success: true,
    data: resultData,
  };
}

/**
 * Execute a promise with timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  promise.catch(() => {});
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timeoutId)
  );
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an adapter for an MCP client
 */
export function createMCPToolAdapter(
  client: MCPClient,
  options?: {
    securityOverrides?: Record<string, MCPSecurityOverride>;
    timeout?: number;
  }
): MCPToolAdapter {
  return new MCPToolAdapter({
    client,
    securityOverrides: options?.securityOverrides,
    timeout: options?.timeout,
  });
}
