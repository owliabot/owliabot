/**
 * MCP Client
 * High-level client for interacting with MCP servers
 */

import { createLogger } from "../utils/logger.js";
import { createTransport, type MCPTransport, StdioTransport, SSETransport } from "./transport.js";
import {
  MCPError,
  MCPErrorCode,
  MCP_PROTOCOL_VERSION,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCMessage,
  type MCPServerConfig,
  type MCPDefaults,
  type InitializeParams,
  type InitializeResult,
  type MCPToolDefinition,
  type ToolsListResult,
  type ToolCallParams,
  type ToolCallResult,
  type ServerCapabilities,
} from "./types.js";

const log = createLogger("mcp:client");

// ============================================================================
// Types
// ============================================================================

export interface MCPClientOptions {
  config: MCPServerConfig;
  defaults?: MCPDefaults;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// ============================================================================
// MCP Client
// ============================================================================

export class MCPClient {
  private transport: MCPTransport | null = null;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private nextId = 1;
  private serverCapabilities: ServerCapabilities | null = null;
  private toolsCache: MCPToolDefinition[] | null = null;
  private connected = false;
  private serverName: string;
  
  constructor(private options: MCPClientOptions) {
    this.serverName = options.config.name;
  }

  get name(): string {
    return this.serverName;
  }

  get capabilities(): ServerCapabilities | null {
    return this.serverCapabilities;
  }

  /**
   * Connect to the MCP server and complete handshake
   */
  async connect(): Promise<void> {
    const { config, defaults } = this.options;

    log.info(`Connecting to MCP server: ${config.name}`);

    // Create and connect transport
    this.transport = createTransport(config, {
      connectTimeout: defaults?.connectTimeout,
    });

    // Set up message handling
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onError((err) => this.handleError(err));
    this.transport.onClose((code) => this.handleClose(code));

    // Connect transport (spawns process for stdio)
    if (this.transport instanceof StdioTransport) {
      await this.transport.connect();
    } else if (this.transport instanceof SSETransport) {
      await this.transport.connect();
    }

    // Perform MCP handshake
    await this.initialize();

    this.connected = true;
    log.info(`Connected to MCP server: ${config.name}`);
  }

  /**
   * Get list of available tools from the server
   */
  async listTools(forceRefresh = false): Promise<MCPToolDefinition[]> {
    if (!forceRefresh && this.toolsCache) {
      return this.toolsCache;
    }

    const tools: MCPToolDefinition[] = [];
    let cursor: string | undefined;

    // Handle pagination
    do {
      const result = await this.request<ToolsListResult>("tools/list", {
        cursor,
      });

      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);

    this.toolsCache = tools;
    log.info(`Loaded ${tools.length} tools from ${this.serverName}`);

    return tools;
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<ToolCallResult> {
    log.debug(`Calling tool ${name} with args:`, args);

    const params: ToolCallParams = { name };
    if (args && Object.keys(args).length > 0) {
      params.arguments = args;
    }

    const result = await this.request<ToolCallResult>("tools/call", params);

    if (result.isError) {
      log.warn(`Tool ${name} returned error:`, result.content);
    }

    return result;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected && (this.transport?.isConnected() ?? false);
  }

  /**
   * Gracefully close the connection
   */
  async close(): Promise<void> {
    log.info(`Closing MCP client: ${this.serverName}`);

    this.connected = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(
        new MCPError("Client closing", MCPErrorCode.CONNECTION_LOST)
      );
      this.pendingRequests.delete(id);
    }

    // Close transport
    await this.transport?.close();
    this.transport = null;

    log.info(`MCP client closed: ${this.serverName}`);
  }

  /**
   * Invalidate tools cache (e.g., on tools/list_changed notification)
   */
  invalidateToolsCache(): void {
    this.toolsCache = null;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async initialize(): Promise<void> {
    const params: InitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        // Client capabilities
        roots: { listChanged: true },
      },
      clientInfo: {
        name: "owliabot",
        version: "0.1.0",
      },
    };

    const result = await this.request<InitializeResult>("initialize", params);

    // Store server capabilities
    this.serverCapabilities = result.capabilities;

    log.debug(`Server capabilities:`, result.capabilities);
    log.debug(`Server info:`, result.serverInfo);

    // Check protocol version
    if (result.protocolVersion !== MCP_PROTOCOL_VERSION) {
      log.warn(
        `Protocol version mismatch: requested ${MCP_PROTOCOL_VERSION}, ` +
          `server returned ${result.protocolVersion}`
      );
    }

    // Send initialized notification
    this.notify("notifications/initialized", {});
  }

  private async request<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!this.transport?.isConnected()) {
      throw new MCPError(
        "Not connected to MCP server",
        MCPErrorCode.CONNECTION_LOST
      );
    }

    const id = this.nextId++;
    const timeout = this.options.defaults?.timeout ?? 30000;

    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new MCPError(
            `Request timeout for method ${method}`,
            MCPErrorCode.TIMEOUT
          )
        );
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      try {
        this.transport!.send(request);
      } catch (err) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    if (!this.transport?.isConnected()) {
      log.warn(`Cannot send notification ${method}: not connected`);
      return;
    }

    this.transport.send({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private handleMessage(message: JSONRPCMessage): void {
    // Check if it's a response (has id)
    if ("id" in message && message.id !== undefined) {
      this.handleResponse(message as JSONRPCResponse);
      return;
    }

    // Otherwise it's a notification
    if ("method" in message) {
      this.handleNotification(message);
    }
  }

  private handleResponse(response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      log.warn(`Received response for unknown request id: ${response.id}`);
      return;
    }

    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timeout);

    if (response.error) {
      pending.reject(
        new MCPError(
          response.error.message,
          MCPErrorCode.PROTOCOL_ERROR,
          response.error
        )
      );
    } else {
      pending.resolve(response.result ?? {});
    }
  }

  private handleNotification(notification: JSONRPCMessage): void {
    if (!("method" in notification)) return;

    const { method } = notification;

    switch (method) {
      case "notifications/tools/list_changed":
        log.info("Tools list changed, invalidating cache");
        this.invalidateToolsCache();
        break;

      default:
        log.debug(`Received notification: ${method}`);
    }
  }

  private handleError(error: Error): void {
    log.error(`Transport error: ${error.message}`);
    // The transport will handle reconnection if configured
  }

  private handleClose(code?: number): void {
    log.info(`Transport closed with code ${code}`);
    this.connected = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(
        new MCPError(
          "Connection lost",
          MCPErrorCode.CONNECTION_LOST,
          { code }
        )
      );
      this.pendingRequests.delete(id);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and connect an MCP client
 */
export async function createMCPClient(
  config: MCPServerConfig,
  defaults?: MCPDefaults
): Promise<MCPClient> {
  const client = new MCPClient({ config, defaults });
  await client.connect();
  return client;
}
