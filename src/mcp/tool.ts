/**
 * MCP Management Tool
 * Allows agents to dynamically manage MCP servers at runtime
 */

import { createLogger } from "../utils/logger.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../agent/tools/interface.js";
import type { MCPManager } from "./manager.js";
import { MCPError, mcpServerConfigSchema } from "./types.js";
import { z } from "zod";

const log = createLogger("mcp:tool");

// ============================================================================
// Parameter Schemas
// ============================================================================

const listParamsSchema = z.object({
  action: z.literal("list"),
});

const addParamsSchema = z.object({
  action: z.literal("add"),
  name: z.string().min(1).describe("Unique name for the server"),
  command: z.string().optional().describe("Command to run (for stdio transport)"),
  args: z.array(z.string()).optional().describe("Arguments for the command"),
  env: z.record(z.string()).optional().describe("Environment variables"),
  url: z.string().url().optional().describe("URL for SSE transport"),
  transport: z.enum(["stdio", "sse"]).default("stdio").describe("Transport type"),
  cwd: z.string().optional().describe("Working directory"),
});

const removeParamsSchema = z.object({
  action: z.literal("remove"),
  name: z.string().min(1).describe("Name of the server to remove"),
});

const refreshParamsSchema = z.object({
  action: z.literal("refresh"),
  name: z.string().min(1).describe("Name of the server to refresh"),
});

const paramsSchema = z.discriminatedUnion("action", [
  listParamsSchema,
  addParamsSchema,
  removeParamsSchema,
  refreshParamsSchema,
]);

type MCPManageParams = z.infer<typeof paramsSchema>;

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create the mcp_manage tool definition
 *
 * @param manager - MCPManager instance to use
 * @returns ToolDefinition for the mcp_manage tool
 *
 * @example
 * ```typescript
 * import { MCPManager, createMCPManageTool } from "./mcp/index.js";
 *
 * const manager = new MCPManager();
 * const tool = createMCPManageTool(manager);
 *
 * // Register with ToolRegistry
 * registry.register(tool);
 * ```
 */
export function createMCPManageTool(manager: MCPManager): ToolDefinition {
  return {
    name: "mcp_manage",
    description: `Manage MCP (Model Context Protocol) servers at runtime.

Actions:
- list: List all connected MCP servers and their tools
- add: Add a new MCP server (returns list of new tools)
- remove: Remove an MCP server
- refresh: Refresh tools from a specific server

Use this to dynamically add specialized tools like Playwright, databases, etc.`,

    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action to perform: list, add, remove, or refresh",
          enum: ["list", "add", "remove", "refresh"],
        },
        name: {
          type: "string",
          description: "Server name (required for add/remove/refresh)",
        },
        command: {
          type: "string",
          description: "Command to run for stdio transport (e.g., 'npx', 'node')",
        },
        args: {
          type: "array",
          description: "Command arguments (e.g., ['@playwright/mcp'])",
          items: { type: "string" },
        },
        env: {
          type: "object",
          description: "Environment variables for the server process",
        },
        url: {
          type: "string",
          description: "URL for SSE transport",
        },
        transport: {
          type: "string",
          description: "Transport type: stdio (default) or sse",
          enum: ["stdio", "sse"],
        },
        cwd: {
          type: "string",
          description: "Working directory for the server process",
        },
      },
      required: ["action"],
    },

    security: {
      level: "write",
      confirmRequired: true, // Requires confirmation as it can spawn arbitrary processes
    },

    execute: async (
      params: unknown,
      _ctx: ToolContext
    ): Promise<ToolResult> => {
      try {
        // Parse and validate params
        const parsed = paramsSchema.parse(params);
        return await executeMCPManage(manager, parsed);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return {
            success: false,
            error: `Invalid parameters: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
          };
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`mcp_manage error: ${errorMsg}`);

        return {
          success: false,
          error: errorMsg,
        };
      }
    },
  };
}

// ============================================================================
// Action Handlers
// ============================================================================

async function executeMCPManage(
  manager: MCPManager,
  params: MCPManageParams
): Promise<ToolResult> {
  switch (params.action) {
    case "list":
      return handleList(manager);

    case "add":
      return handleAdd(manager, params);

    case "remove":
      return handleRemove(manager, params);

    case "refresh":
      return handleRefresh(manager, params);

    default:
      return {
        success: false,
        error: `Unknown action: ${(params as { action: string }).action}`,
      };
  }
}

function handleList(manager: MCPManager): ToolResult {
  const servers = manager.listServers();

  if (servers.length === 0) {
    return {
      success: true,
      data: {
        message: "No MCP servers connected",
        servers: [],
        totalTools: 0,
      },
    };
  }

  const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);

  return {
    success: true,
    data: {
      message: `${servers.length} MCP server(s) connected with ${totalTools} total tools`,
      servers: servers.map((s) => ({
        name: s.name,
        connected: s.connected,
        toolCount: s.toolCount,
        tools: s.tools,
        transport: s.transport,
        addedAt: s.addedAt.toISOString(),
      })),
      totalTools,
    },
  };
}

async function handleAdd(
  manager: MCPManager,
  params: z.infer<typeof addParamsSchema>
): Promise<ToolResult> {
  // Build server config
  const config = {
    name: params.name,
    command: params.command,
    args: params.args ?? [],
    env: params.env,
    url: params.url,
    transport: params.transport,
    cwd: params.cwd,
  };

  // Validate with the schema
  try {
    mcpServerConfigSchema.parse(config);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid server configuration: ${err.errors.map((e) => e.message).join(", ")}`,
      };
    }
    throw err;
  }

  try {
    const toolNames = await manager.addServer(config);

    return {
      success: true,
      data: {
        message: `Added MCP server "${params.name}" with ${toolNames.length} tools`,
        serverName: params.name,
        tools: toolNames,
        toolCount: toolNames.length,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to add server "${params.name}": ${errorMsg}`,
    };
  }
}

async function handleRemove(
  manager: MCPManager,
  params: z.infer<typeof removeParamsSchema>
): Promise<ToolResult> {
  if (!manager.hasServer(params.name)) {
    return {
      success: false,
      error: `Server "${params.name}" not found`,
    };
  }

  try {
    await manager.removeServer(params.name);

    return {
      success: true,
      data: {
        message: `Removed MCP server "${params.name}"`,
        serverName: params.name,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to remove server "${params.name}": ${errorMsg}`,
    };
  }
}

async function handleRefresh(
  manager: MCPManager,
  params: z.infer<typeof refreshParamsSchema>
): Promise<ToolResult> {
  if (!manager.hasServer(params.name)) {
    return {
      success: false,
      error: `Server "${params.name}" not found`,
    };
  }

  try {
    await manager.refreshServer(params.name);

    // Get updated server info
    const servers = manager.listServers();
    const serverInfo = servers.find((s) => s.name === params.name);

    return {
      success: true,
      data: {
        message: `Refreshed MCP server "${params.name}"`,
        serverName: params.name,
        tools: serverInfo?.tools ?? [],
        toolCount: serverInfo?.toolCount ?? 0,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to refresh server "${params.name}": ${errorMsg}`,
    };
  }
}
