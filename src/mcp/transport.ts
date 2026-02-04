/**
 * MCP Transport Abstraction
 * Handles communication with MCP servers via different transport mechanisms
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { createLogger } from "../utils/logger.js";
import { MCPError, MCPErrorCode, type JSONRPCMessage, type MCPServerConfig } from "./types.js";

const log = createLogger("mcp:transport");

// ============================================================================
// Transport Interface
// ============================================================================

export type MessageCallback = (message: JSONRPCMessage) => void;
export type ErrorCallback = (error: Error) => void;
export type CloseCallback = (code?: number) => void;

export interface MCPTransport {
  /** Send a JSON-RPC message to the server */
  send(message: JSONRPCMessage): void;

  /** Register a callback for incoming messages */
  onMessage(callback: MessageCallback): void;

  /** Register a callback for transport errors */
  onError(callback: ErrorCallback): void;

  /** Register a callback for transport close */
  onClose(callback: CloseCallback): void;

  /** Close the transport and clean up resources */
  close(): Promise<void>;

  /** Check if transport is connected */
  isConnected(): boolean;
}

// ============================================================================
// Stdio Transport
// ============================================================================

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  connectTimeout?: number;
}

/**
 * Stdio transport implementation
 * Spawns MCP server as subprocess, communicates via stdin/stdout
 */
export class StdioTransport implements MCPTransport {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private messageCallback: MessageCallback | null = null;
  private errorCallback: ErrorCallback | null = null;
  private closeCallback: CloseCallback | null = null;
  private connected = false;
  private closing = false;

  constructor(private options: StdioTransportOptions) {}

  /**
   * Start the MCP server process and establish connection
   */
  async connect(): Promise<void> {
    const { command, args = [], env, cwd, connectTimeout = 10000 } = this.options;

    log.info(`Starting MCP server: ${command} ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(
          new MCPError(
            `Connection timeout after ${connectTimeout}ms`,
            MCPErrorCode.CONNECTION_FAILED
          )
        );
      }, connectTimeout);

      try {
        // Spawn the MCP server process
        this.process = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...env },
          cwd,
          shell: false,
        });

        if (!this.process.stdout || !this.process.stdin) {
          clearTimeout(timeout);
          reject(
            new MCPError(
              "Failed to create process stdio streams",
              MCPErrorCode.SERVER_SPAWN_FAILED
            )
          );
          return;
        }

        // Set up readline for line-delimited JSON messages
        this.readline = createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });

        this.readline.on("line", (line) => {
          this.handleLine(line);
        });

        // Handle stderr for logging
        this.process.stderr?.on("data", (data) => {
          const text = data.toString().trim();
          if (text) {
            log.debug(`[server stderr] ${text}`);
          }
        });

        // Handle process errors
        this.process.on("error", (err) => {
          log.error(`Process error: ${err.message}`);
          if (!this.connected) {
            clearTimeout(timeout);
            reject(
              new MCPError(
                `Failed to spawn MCP server: ${err.message}`,
                MCPErrorCode.SERVER_SPAWN_FAILED,
                err
              )
            );
          } else {
            this.errorCallback?.(err);
          }
        });

        // Handle process exit
        this.process.on("exit", (code, signal) => {
          log.info(`MCP server exited with code ${code}, signal ${signal}`);
          this.connected = false;
          if (!this.closing) {
            this.closeCallback?.(code ?? undefined);
          }
        });

        // Consider connected once process is spawned successfully
        // The actual protocol handshake happens at the client level
        this.process.once("spawn", () => {
          clearTimeout(timeout);
          this.connected = true;
          log.info("MCP server process started");
          resolve();
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(
          new MCPError(
            `Failed to spawn MCP server: ${err instanceof Error ? err.message : String(err)}`,
            MCPErrorCode.SERVER_SPAWN_FAILED,
            err
          )
        );
      }
    });
  }

  send(message: JSONRPCMessage): void {
    if (!this.connected || !this.process?.stdin) {
      throw new MCPError(
        "Transport not connected",
        MCPErrorCode.CONNECTION_LOST
      );
    }

    const json = JSON.stringify(message);
    log.debug(`>>> ${json}`);
    this.process.stdin.write(json + "\n");
  }

  onMessage(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  onClose(callback: CloseCallback): void {
    this.closeCallback = callback;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;

    log.info("Closing stdio transport");

    this.cleanup();

    // Give the process time to exit gracefully
    if (this.process && !this.process.killed) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          log.warn("Process did not exit gracefully, sending SIGKILL");
          this.process?.kill("SIGKILL");
          resolve();
        }, 5000);

        this.process!.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });

        // Close stdin to signal shutdown
        this.process!.stdin?.end();
        this.process!.kill("SIGTERM");
      });
    }

    this.process = null;
    this.connected = false;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    log.debug(`<<< ${line}`);

    try {
      const message = JSON.parse(line) as JSONRPCMessage;
      this.messageCallback?.(message);
    } catch (err) {
      log.error(`Failed to parse message: ${err instanceof Error ? err.message : String(err)}`);
      this.errorCallback?.(
        new MCPError(
          "Invalid JSON message from server",
          MCPErrorCode.INVALID_RESPONSE,
          { line }
        )
      );
    }
  }

  private cleanup(): void {
    this.readline?.close();
    this.readline = null;
  }
}

// ============================================================================
// SSE Transport (Stub)
// ============================================================================

export interface SSETransportOptions {
  url: string;
  connectTimeout?: number;
}

/**
 * SSE transport implementation (stub for future implementation)
 */
export class SSETransport implements MCPTransport {
  constructor(private options: SSETransportOptions) {}

  async connect(): Promise<void> {
    throw new MCPError(
      "SSE transport not yet implemented",
      MCPErrorCode.CONNECTION_FAILED
    );
  }

  send(_message: JSONRPCMessage): void {
    throw new MCPError(
      "SSE transport not yet implemented",
      MCPErrorCode.CONNECTION_FAILED
    );
  }

  onMessage(_callback: MessageCallback): void {
    // Not implemented
  }

  onError(_callback: ErrorCallback): void {
    // Not implemented
  }

  onClose(_callback: CloseCallback): void {
    // Not implemented
  }

  isConnected(): boolean {
    return false;
  }

  async close(): Promise<void> {
    // Not implemented
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create appropriate transport based on server configuration
 */
export function createTransport(
  config: MCPServerConfig,
  defaults?: { connectTimeout?: number }
): StdioTransport | SSETransport {
  if (config.transport === "sse") {
    if (!config.url) {
      throw new MCPError(
        "SSE transport requires url configuration",
        MCPErrorCode.CONNECTION_FAILED
      );
    }
    return new SSETransport({
      url: config.url,
      connectTimeout: defaults?.connectTimeout,
    });
  }

  // Default to stdio
  if (!config.command) {
    throw new MCPError(
      "Stdio transport requires command configuration",
      MCPErrorCode.CONNECTION_FAILED
    );
  }

  return new StdioTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    connectTimeout: defaults?.connectTimeout,
  });
}
