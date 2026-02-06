/**
 * MCP Manager
 * Dynamic management of MCP servers at runtime
 *
 * Allows adding/removing MCP servers dynamically without restarting the agent.
 * This is the primary API for managing MCP connections in OwliaBot.
 */

import { createLogger } from "../utils/logger.js";
import { MCPClient, createMCPClient } from "./client.js";
import { MCPToolAdapter, createMCPToolAdapter } from "./adapter.js";
import {
  MCPError,
  MCPErrorCode,
  mcpServerConfigSchema,
  type MCPServerConfig,
  type MCPDefaults,
  type MCPSecurityOverride,
} from "./types.js";
import type { ToolDefinition } from "../agent/tools/interface.js";

const log = createLogger("mcp:manager");

// ============================================================================
// Types
// ============================================================================

/** Information about a connected MCP server */
export interface MCPServerInfo {
  /** Server name (unique identifier) */
  name: string;
  /** Connection status */
  connected: boolean;
  /** Number of tools provided by this server */
  toolCount: number;
  /** Tool names provided by this server */
  tools: string[];
  /** Transport type */
  transport: "stdio" | "sse";
  /** When the server was added */
  addedAt: Date;
}

/** Stored server metadata */
interface ServerMetadata {
  addedAt: Date;
  transport: "stdio" | "sse";
}

/** Callback for tool changes */
export type ToolsChangedCallback = (tools: ToolDefinition[]) => void;

// ============================================================================
// MCPManager Class
// ============================================================================

/**
 * Manages MCP server connections dynamically
 *
 * @example
 * ```typescript
 * const manager = new MCPManager();
 *
 * // Add a server at runtime
 * const tools = await manager.addServer({
 *   name: "playwright",
 *   command: "npx",
 *   args: ["@playwright/mcp"],
 * });
 *
 * // Get all tools (async, ensures cache is populated)
 * const allTools = await manager.getToolsAsync();
 *
 * // Get cached tools (sync, returns empty if not yet loaded)
 * const cachedTools = manager.getTools();
 *
 * // Remove a server
 * await manager.removeServer("playwright");
 *
 * // Clean up
 * await manager.close();
 * ```
 */
export class MCPManager {
  private clients = new Map<string, MCPClient>();
  private adapters = new Map<string, MCPToolAdapter>();
  private serverInfos = new Map<string, ServerMetadata>();
  private toolsCache: ToolDefinition[] | null = null;
  private toolsChangedCallbacks = new Set<ToolsChangedCallback>();
  private defaults?: MCPDefaults;
  private securityOverrides: Record<string, MCPSecurityOverride> = {};

  constructor(options?: {
    defaults?: MCPDefaults;
    securityOverrides?: Record<string, MCPSecurityOverride>;
  }) {
    this.defaults = options?.defaults;
    this.securityOverrides = options?.securityOverrides ?? {};
  }

  /**
   * Add a new MCP server dynamically
   *
   * @param config - Server configuration
   * @returns Array of tool names added by this server
   * @throws MCPError if server name already exists or connection fails
   */
  async addServer(config: MCPServerConfig): Promise<string[]> {
    // Validate configuration
    const validatedConfig = mcpServerConfigSchema.parse(config);

    // Check for duplicate name
    if (this.clients.has(validatedConfig.name)) {
      throw new MCPError(
        `Server "${validatedConfig.name}" already exists`,
        MCPErrorCode.CONNECTION_FAILED
      );
    }

    log.info(`Adding MCP server: ${validatedConfig.name}`);

    try {
      // Create and connect client
      const client = await createMCPClient(validatedConfig, this.defaults);
      this.clients.set(validatedConfig.name, client);

      // Create adapter with security overrides
      const serverOverrides = this.filterSecurityOverrides(validatedConfig.name);
      const adapter = createMCPToolAdapter(client, {
        securityOverrides: serverOverrides,
        timeout: this.defaults?.timeout,
      });
      this.adapters.set(validatedConfig.name, adapter);

      // Store server info with transport type
      const transport = validatedConfig.transport ?? "stdio";
      this.serverInfos.set(validatedConfig.name, { 
        addedAt: new Date(),
        transport: transport as "stdio" | "sse",
      });

      // Get tools and invalidate cache
      const tools = await adapter.getTools();
      this.invalidateToolsCache();

      // Set up tools changed listener
      // Note: We fetch tools async first to repopulate cache before notifying
      client.onToolsChanged(() => {
        adapter.invalidateCache();
        this.invalidateToolsCache();
        // Fetch tools async to repopulate cache, then notify
        adapter.getTools().then(() => {
          this.notifyToolsChanged();
        }).catch((err) => {
          log.warn(`Failed to refresh tools after list_changed: ${err}`);
          // Still notify even on error so listeners know something changed
          this.notifyToolsChanged();
        });
      });

      log.info(
        `Added MCP server "${validatedConfig.name}" with ${tools.length} tools`
      );

      // Notify listeners
      this.notifyToolsChanged();

      return tools.map((t) => t.name);
    } catch (err) {
      // Clean up on failure - close client first if it was created
      const client = this.clients.get(validatedConfig.name);
      if (client) {
        try {
          await client.close();
        } catch (closeErr) {
          log.warn(`Failed to close client during cleanup: ${closeErr}`);
        }
      }
      this.clients.delete(validatedConfig.name);
      this.adapters.delete(validatedConfig.name);
      this.serverInfos.delete(validatedConfig.name);

      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to add MCP server "${validatedConfig.name}": ${errorMsg}`);

      throw err instanceof MCPError
        ? err
        : new MCPError(
            `Failed to connect to MCP server: ${errorMsg}`,
            MCPErrorCode.CONNECTION_FAILED,
            err
          );
    }
  }

  /**
   * Remove an MCP server
   *
   * @param name - Server name to remove
   * @throws MCPError if server doesn't exist
   */
  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      throw new MCPError(
        `Server "${name}" not found`,
        MCPErrorCode.CONNECTION_FAILED
      );
    }

    log.info(`Removing MCP server: ${name}`);

    try {
      await client.close();
    } catch (err) {
      log.warn(
        `Error closing client for "${name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    this.clients.delete(name);
    this.adapters.delete(name);
    this.serverInfos.delete(name);
    this.invalidateToolsCache();

    log.info(`Removed MCP server: ${name}`);

    // Notify listeners
    this.notifyToolsChanged();
  }

  /**
   * List all connected MCP servers
   */
  listServers(): MCPServerInfo[] {
    const servers: MCPServerInfo[] = [];

    for (const [name, client] of this.clients) {
      const adapter = this.adapters.get(name);
      const info = this.serverInfos.get(name);

      let tools: ToolDefinition[] = [];
      try {
        // Use cached tools if available (getTools is async, but cache is sync)
        tools = adapter ? this.getToolsForServer(name) : [];
      } catch {
        // Ignore errors getting tools
      }

      servers.push({
        name,
        connected: client.isConnected(),
        toolCount: tools.length,
        tools: tools.map((t) => t.name),
        transport: info?.transport ?? "stdio",
        addedAt: info?.addedAt ?? new Date(),
      });
    }

    return servers;
  }

  /**
   * Get all tools from all connected servers (sync, uses cache)
   * 
   * Note: Returns cached tools only. Use getToolsAsync() to ensure
   * tools are loaded from servers that haven't been queried yet.
   */
  getTools(): ToolDefinition[] {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    const allTools: ToolDefinition[] = [];
    const seenNames = new Set<string>();

    for (const [name] of this.adapters) {
      try {
        const tools = this.getToolsForServer(name);
        for (const tool of tools) {
          if (!seenNames.has(tool.name)) {
            seenNames.add(tool.name);
            allTools.push(tool);
          } else {
            log.warn(`Duplicate tool name: ${tool.name}, skipping`);
          }
        }
      } catch (err) {
        log.error(
          `Failed to get tools from server "${name}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    this.toolsCache = allTools;
    return allTools;
  }

  /**
   * Get all tools from all connected servers (async, populates cache)
   * 
   * This method ensures all adapters have loaded their tools before returning.
   * Prefer this over getTools() when you need guaranteed fresh/complete results.
   */
  async getToolsAsync(): Promise<ToolDefinition[]> {
    // Invalidate cache to force refresh
    this.toolsCache = null;

    const allTools: ToolDefinition[] = [];
    const seenNames = new Set<string>();

    for (const [name] of this.adapters) {
      try {
        const tools = await this.getToolsForServerAsync(name);
        for (const tool of tools) {
          if (!seenNames.has(tool.name)) {
            seenNames.add(tool.name);
            allTools.push(tool);
          } else {
            log.warn(`Duplicate tool name: ${tool.name}, skipping`);
          }
        }
      } catch (err) {
        log.error(
          `Failed to get tools from server "${name}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    this.toolsCache = allTools;
    return allTools;
  }

  /**
   * Refresh tools from a specific server
   *
   * @param name - Server name to refresh
   * @throws MCPError if server doesn't exist
   */
  async refreshServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    const adapter = this.adapters.get(name);

    if (!client || !adapter) {
      throw new MCPError(
        `Server "${name}" not found`,
        MCPErrorCode.CONNECTION_FAILED
      );
    }

    log.info(`Refreshing MCP server: ${name}`);

    client.invalidateToolsCache();
    adapter.invalidateCache();

    // Force refresh by calling listTools
    await client.listTools(true);
    await adapter.getTools();

    this.invalidateToolsCache();
    this.notifyToolsChanged();

    log.info(`Refreshed MCP server: ${name}`);
  }

  /**
   * Close all MCP connections
   */
  async close(): Promise<void> {
    log.info("Closing all MCP connections");

    const closePromises: Promise<void>[] = [];

    for (const [name, client] of this.clients) {
      closePromises.push(
        client.close().catch((err) => {
          log.error(
            `Error closing client "${name}": ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        })
      );
    }

    await Promise.all(closePromises);

    this.clients.clear();
    this.adapters.clear();
    this.serverInfos.clear();
    this.toolsCache = null;
    this.toolsChangedCallbacks.clear();

    log.info("All MCP connections closed");
  }

  /**
   * Register a callback for when tools change
   *
   * @param callback - Function to call when tools change
   * @returns Unsubscribe function
   */
  onToolsChanged(callback: ToolsChangedCallback): () => void {
    this.toolsChangedCallbacks.add(callback);
    return () => {
      this.toolsChangedCallbacks.delete(callback);
    };
  }

  /**
   * Check if a server exists
   */
  hasServer(name: string): boolean {
    return this.clients.has(name);
  }

  /**
   * Get the number of connected servers
   */
  get serverCount(): number {
    return this.clients.size;
  }

  /**
   * Update security overrides
   */
  setSecurityOverrides(overrides: Record<string, MCPSecurityOverride>): void {
    this.securityOverrides = overrides;
    // Note: This won't update existing adapters - they'd need to be recreated
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private invalidateToolsCache(): void {
    this.toolsCache = null;
  }

  private notifyToolsChanged(): void {
    const tools = this.getTools();
    for (const callback of this.toolsChangedCallbacks) {
      try {
        callback(tools);
      } catch (err) {
        log.error(
          `Tools changed callback error: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  private filterSecurityOverrides(
    serverName: string
  ): Record<string, MCPSecurityOverride> {
    const prefix = `${serverName}__`;
    const filtered: Record<string, MCPSecurityOverride> = {};

    for (const [key, value] of Object.entries(this.securityOverrides)) {
      if (key.startsWith(prefix)) {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * Get tools for a specific server (sync, uses cache)
   */
  private getToolsForServer(name: string): ToolDefinition[] {
    const adapter = this.adapters.get(name);
    if (!adapter) return [];

    // Use the public getCachedTools() method
    return adapter.getCachedTools();
  }

  /**
   * Get tools for a specific server (async, populates cache if needed)
   */
  private async getToolsForServerAsync(name: string): Promise<ToolDefinition[]> {
    const adapter = this.adapters.get(name);
    if (!adapter) return [];

    return adapter.getTools();
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new MCP manager instance
 */
export function createMCPManager(options?: {
  defaults?: MCPDefaults;
  securityOverrides?: Record<string, MCPSecurityOverride>;
}): MCPManager {
  return new MCPManager(options);
}
