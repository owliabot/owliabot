/**
 * MCP Module - Public API
 * Provides Model Context Protocol support for OwliaBot
 */

import { createLogger } from "../utils/logger.js";
import { MCPClient, createMCPClient } from "./client.js";
import { MCPToolAdapter, createMCPToolAdapter } from "./adapter.js";
import {
  MCPError,
  MCPErrorCode,
  mcpConfigSchema,
  type MCPConfig,
  type MCPServerConfig,
  type MCPSecurityOverride,
} from "./types.js";
import type { ToolDefinition } from "../agent/tools/interface.js";
import type { LLMProvider } from "../agent/runner.js";
import { attemptAutoRepair, MAX_REPAIR_ATTEMPTS } from "./auto-repair.js";

// Re-export types and classes
export { MCPClient, createMCPClient } from "./client.js";
export { MCPToolAdapter, createMCPToolAdapter } from "./adapter.js";
export {
  StdioTransport,
  SSETransport,
  createTransport,
  type MCPTransport,
} from "./transport.js";
export {
  MCPError,
  MCPErrorCode,
  mcpConfigSchema,
  mcpServerConfigSchema,
  mcpSecurityOverrideSchema,
  mcpDefaultsSchema,
  type MCPConfig,
  type MCPServerConfig,
  type MCPSecurityOverride,
  type MCPDefaults,
  type MCPToolDefinition,
  type ToolCallResult,
} from "./types.js";

// Re-export auto-repair
export { attemptAutoRepair, type RepairContext, type RepairResult } from "./auto-repair.js";

// Re-export manager
export {
  MCPManager,
  createMCPManager,
  type MCPServerInfo,
  type ToolsChangedCallback,
} from "./manager.js";

// Re-export tool
export { createMCPManageTool } from "./tool.js";

const log = createLogger("mcp");

// ============================================================================
// Types
// ============================================================================

export interface CreateMCPToolsResult {
  /** All loaded tool definitions */
  tools: ToolDefinition[];
  
  /** Connected MCP clients by server name */
  clients: Map<string, MCPClient>;
  
  /** Adapters by server name */
  adapters: Map<string, MCPToolAdapter>;
  
  /** Servers that failed to connect */
  failed: Array<{
    name: string;
    error: string;
  }>;
  
  /** Refresh tools from all connected servers */
  refreshTools: () => Promise<ToolDefinition[]>;
  
  /** Close all connections */
  close: () => Promise<void>;
}

// ============================================================================
// Main Factory
// ============================================================================

/**
 * Create MCP tools from configuration
 * 
 * This is the main entry point for MCP integration. It:
 * 1. Validates configuration
 * 2. Connects to all configured MCP servers
 * 3. Retrieves and adapts tools from each server
 * 4. Returns tools ready for registration with ToolRegistry
 * 
 * @example
 * ```typescript
 * import { createMCPTools } from "./mcp/index.js";
 * 
 * const result = await createMCPTools({
 *   servers: [
 *     { name: "playwright", command: "npx", args: ["@anthropic/mcp-server-playwright"] }
 *   ]
 * });
 * 
 * // Register tools
 * for (const tool of result.tools) {
 *   registry.register(tool);
 * }
 * 
 * // Clean up on shutdown
 * await result.close();
 * ```
 */
export async function createMCPTools(
  config: MCPConfig | unknown,
  options?: { providers?: LLMProvider[] },
): Promise<CreateMCPToolsResult> {
  // Validate configuration
  const validatedConfig = mcpConfigSchema.parse(config);
  const { servers, securityOverrides, defaults } = validatedConfig;

  if (servers.length === 0) {
    log.info("No MCP servers configured");
    return {
      tools: [],
      clients: new Map(),
      adapters: new Map(),
      failed: [],
      refreshTools: async () => [],
      close: async () => {},
    };
  }

  const clients = new Map<string, MCPClient>();
  const adapters = new Map<string, MCPToolAdapter>();
  const failed: Array<{ name: string; error: string }> = [];
  let allTools: ToolDefinition[] = [];

  const autoRepairEnabled = defaults?.autoRepair !== false;
  const repairProvider = options?.providers?.[0]; // Use first (highest priority) provider

  // Connect to each server
  for (const serverConfig of servers) {
    const connectServer = async (): Promise<boolean> => {
      const client = await createMCPClient(serverConfig, defaults);
      clients.set(serverConfig.name, client);

      const serverOverrides = filterSecurityOverrides(
        securityOverrides ?? {},
        serverConfig.name
      );
      const adapter = createMCPToolAdapter(client, {
        securityOverrides: serverOverrides,
        timeout: defaults?.timeout,
      });
      adapters.set(serverConfig.name, adapter);

      const tools = await adapter.getTools();
      allTools.push(...tools);

      log.info(
        `Loaded ${tools.length} tools from MCP server: ${serverConfig.name}`
      );
      return true;
    };

    try {
      log.info(`Connecting to MCP server: ${serverConfig.name}`);
      await connectServer();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to connect to MCP server ${serverConfig.name}: ${errorMsg}`);

      // Attempt LLM-driven auto-repair if enabled and a provider is available
      let repaired = false;
      if (autoRepairEnabled && repairProvider) {
        for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
          log.info(
            `Auto-repair attempt ${attempt + 1}/${MAX_REPAIR_ATTEMPTS} for "${serverConfig.name}"`
          );

          const result = await attemptAutoRepair(
            {
              serverName: serverConfig.name,
              command: serverConfig.command ?? "",
              args: serverConfig.args,
              errorOutput: errorMsg,
              exitCode: undefined,
            },
            repairProvider,
          );

          if (!result.attempted) {
            log.info(`No repair suggested for "${serverConfig.name}", skipping`);
            break;
          }

          if (!result.repairSucceeded) {
            log.warn(
              `Repair command failed for "${serverConfig.name}": ${result.repairError}`
            );
            continue;
          }

          log.info(`Repair command succeeded for "${serverConfig.name}", retrying connection`);

          try {
            await connectServer();
            repaired = true;
            break;
          } catch (retryErr) {
            log.warn(
              `Retry after repair still failed for "${serverConfig.name}": ${
                retryErr instanceof Error ? retryErr.message : String(retryErr)
              }`
            );
          }
        }
      }

      if (!repaired) {
        failed.push({
          name: serverConfig.name,
          error: errorMsg,
        });
      }
    }
  }

  // Check for duplicate tool names and warn
  const toolNames = new Set<string>();
  for (const tool of allTools) {
    if (toolNames.has(tool.name)) {
      log.warn(`Duplicate tool name detected: ${tool.name} — only the first will be used`);
    } else {
      toolNames.add(tool.name);
    }
  }

  log.info(
    `MCP initialization complete: ${allTools.length} tools loaded, ` +
      `${failed.length} servers failed`
  );

  // Return result with management functions
  return {
    tools: allTools,
    clients,
    adapters,
    failed,

    async refreshTools(): Promise<ToolDefinition[]> {
      allTools = [];
      for (const [name, adapter] of adapters) {
        const client = clients.get(name);
        client?.invalidateToolsCache();
        adapter.invalidateCache();
        try {
          const tools = await adapter.getTools();
          allTools.push(...tools);
        } catch (err) {
          log.error(`Failed to refresh tools from ${name}:`, err);
        }
      }
      return allTools;
    },

    async close(): Promise<void> {
      log.info("Closing all MCP connections");
      const closePromises: Promise<void>[] = [];
      for (const [name, client] of clients) {
        closePromises.push(
          client.close().catch((err) => {
            log.error(`Error closing MCP client ${name}:`, err);
          })
        );
      }
      await Promise.all(closePromises);
      clients.clear();
      adapters.clear();
      allTools = [];
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Filter security overrides to only those applicable to a specific server
 */
function filterSecurityOverrides(
  overrides: Record<string, MCPSecurityOverride>,
  serverName: string
): Record<string, MCPSecurityOverride> {
  const prefix = `${serverName}__`;
  const filtered: Record<string, MCPSecurityOverride> = {};

  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith(prefix)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Load MCP tools and integrate with existing ToolRegistry
 * 
 * Convenience function that combines createMCPTools with registry registration
 */
export async function integrateWithRegistry(
  config: MCPConfig | unknown,
  registry: { register: (tool: ToolDefinition) => void }
): Promise<CreateMCPToolsResult> {
  const result = await createMCPTools(config);

  for (const tool of result.tools) {
    registry.register(tool);
  }

  return result;
}
