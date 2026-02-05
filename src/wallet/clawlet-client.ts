/**
 * Clawlet Unix Socket Client
 *
 * Communicates with clawlet daemon via Unix domain socket using JSON-RPC 2.0.
 * @see discovery/owliabot-clawlet-integration.md
 */

import { createConnection, Socket } from "node:net";
import { createLogger } from "../utils/logger.js";
import { EventEmitter } from "node:events";

const log = createLogger("clawlet-client");

// ============================================================================
// Types
// ============================================================================

/** Balance query parameters */
export interface BalanceQuery {
  /** Wallet address (0x-prefixed) */
  address: string;
  /** Chain ID (e.g. 1 for mainnet, 8453 for Base) */
  chain_id: number;
}

/** Single token balance */
export interface TokenBalance {
  /** Token symbol (e.g. "USDC") */
  symbol: string;
  /** Human-readable balance string */
  balance: string;
  /** Token contract address */
  address: string;
}

/** Balance query response */
export interface BalanceResponse {
  /** Native ETH balance as human-readable string */
  eth: string;
  /** ERC-20 token balances */
  tokens: TokenBalance[];
}

/** Transfer request parameters */
export interface TransferRequest {
  /** Recipient address (0x-prefixed) */
  to: string;
  /** Amount as decimal string (e.g. "1.0") */
  amount: string;
  /** Token to transfer — "ETH" for native, or symbol/address */
  token: string;
  /** Chain ID to execute on */
  chain_id: number;
}

/** Transfer response */
export interface TransferResponse {
  /** "success" or "denied" */
  status: "success" | "denied";
  /** Transaction hash (present on success) */
  tx_hash?: string;
  /** Audit event ID (present on success) */
  audit_id?: string;
  /** Denial reason (present on denial) */
  reason?: string;
}

/** Health check response */
export interface HealthResponse {
  status: "ok" | "error";
  version?: string;
}

/** Auth grant request */
export interface AuthGrantRequest {
  /** Admin password */
  password: string;
  /** Token scope: "read" or "trade" */
  scope: "read" | "trade";
  /** Token TTL in hours (optional) */
  expires_hours?: number;
  /** Agent ID for audit (optional) */
  agent_id?: string;
}

/** Auth grant response */
export interface AuthGrantResponse {
  /** The granted token (e.g., "clwt_xxx") */
  token: string;
  /** Token scope */
  scope: string;
  /** Expiration timestamp (ISO 8601) */
  expires_at: string;
}

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
  meta?: {
    authorization?: string;
  };
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number;
}

/** Client configuration */
export interface ClawletClientConfig {
  /** Unix socket path (default: /run/clawlet/clawlet.sock) */
  socketPath?: string;
  /** Auth token for API calls */
  authToken?: string;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number;
}

/** Client error types */
export class ClawletError extends Error {
  constructor(
    message: string,
    public code: "CONNECTION_FAILED" | "TIMEOUT" | "UNAUTHORIZED" | "RPC_ERROR" | "INVALID_RESPONSE",
    public details?: unknown
  ) {
    super(message);
    this.name = "ClawletError";
  }
}

// ============================================================================
// Client Implementation
// ============================================================================

const DEFAULT_SOCKET_PATH = "/run/clawlet/clawlet.sock";
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_REQUEST_TIMEOUT = 30000;

/**
 * Clawlet Unix Socket Client
 *
 * Example usage:
 * ```typescript
 * const client = new ClawletClient({
 *   socketPath: "/run/clawlet/clawlet.sock",
 *   authToken: "your-token-here"
 * });
 *
 * const balance = await client.balance({
 *   address: "0x...",
 *   chain_id: 8453
 * });
 * ```
 */
export class ClawletClient extends EventEmitter {
  private config: Required<ClawletClientConfig>;
  private requestId = 0;

  constructor(config: ClawletClientConfig = {}) {
    super();
    this.config = {
      socketPath: config.socketPath ?? DEFAULT_SOCKET_PATH,
      authToken: config.authToken ?? "",
      connectTimeout: config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT,
      requestTimeout: config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
    };
  }

  /**
   * Update the auth token
   */
  setAuthToken(token: string): void {
    this.config.authToken = token;
  }

  /**
   * Health check — does not require auth
   */
  async health(): Promise<HealthResponse> {
    return this.call<HealthResponse>("health", undefined, false);
  }

  /**
   * Grant an auth token using admin password
   * Does not require existing auth token
   */
  async authGrant(req: AuthGrantRequest): Promise<AuthGrantResponse> {
    const response = await this.call<AuthGrantResponse>("auth.grant", req, false);
    // Optionally auto-set the token
    if (response.token) {
      this.config.authToken = response.token;
    }
    return response;
  }

  /**
   * Query ETH and token balances
   * Requires: Read scope token
   */
  async balance(query: BalanceQuery): Promise<BalanceResponse> {
    this.validateAddress(query.address);
    return this.call<BalanceResponse>("balance", query);
  }

  /**
   * Execute a transfer
   * Requires: Trade scope token
   */
  async transfer(req: TransferRequest): Promise<TransferResponse> {
    this.validateAddress(req.to);
    if (!req.amount || isNaN(parseFloat(req.amount))) {
      throw new ClawletError("Invalid amount", "RPC_ERROR");
    }
    return this.call<TransferResponse>("transfer", req);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make a JSON-RPC call over Unix socket
   */
  private async call<T>(
    method: string,
    params?: unknown,
    requireAuth = true
  ): Promise<T> {
    if (requireAuth && !this.config.authToken) {
      throw new ClawletError("Auth token required", "UNAUTHORIZED");
    }

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: ++this.requestId,
    };

    if (requireAuth && this.config.authToken) {
      request.meta = {
        authorization: `Bearer ${this.config.authToken}`,
      };
    }

    const response = await this.sendRequest<T>(request);
    return response;
  }

  /**
   * Send request over Unix socket and wait for response
   */
  private sendRequest<T>(request: JsonRpcRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: this.config.socketPath });
      let responseData = "";
      let resolved = false;

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const handleResolve = (value: T) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(value);
        }
      };

      const handleReject = (error: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(error);
        }
      };

      // Connection timeout
      const connectTimer = setTimeout(() => {
        handleReject(
          new ClawletError(
            `Connection timeout after ${this.config.connectTimeout}ms`,
            "TIMEOUT"
          )
        );
      }, this.config.connectTimeout);

      // Request timeout
      const requestTimer = setTimeout(() => {
        handleReject(
          new ClawletError(
            `Request timeout after ${this.config.requestTimeout}ms`,
            "TIMEOUT"
          )
        );
      }, this.config.requestTimeout);

      socket.on("connect", () => {
        clearTimeout(connectTimer);
        log.debug(`Connected to ${this.config.socketPath}`);

        // Send request as JSON line
        const payload = JSON.stringify(request) + "\n";
        socket.write(payload);
      });

      socket.on("data", (chunk) => {
        responseData += chunk.toString();

        // Check for complete JSON response (newline-delimited)
        const newlineIdx = responseData.indexOf("\n");
        if (newlineIdx !== -1) {
          clearTimeout(requestTimer);
          const jsonStr = responseData.slice(0, newlineIdx);

          try {
            const response = JSON.parse(jsonStr) as JsonRpcResponse<T>;

            if (response.error) {
              // Map error codes
              const code =
                response.error.code === -32001
                  ? "UNAUTHORIZED"
                  : "RPC_ERROR";

              handleReject(
                new ClawletError(
                  response.error.message,
                  code,
                  response.error.data
                )
              );
              return;
            }

            if (response.result === undefined) {
              handleReject(
                new ClawletError("No result in response", "INVALID_RESPONSE")
              );
              return;
            }

            handleResolve(response.result);
          } catch (err) {
            handleReject(
              new ClawletError(
                `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
                "INVALID_RESPONSE"
              )
            );
          }
        }
      });

      socket.on("error", (err) => {
        clearTimeout(connectTimer);
        clearTimeout(requestTimer);

        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          handleReject(
            new ClawletError(
              `Socket not found: ${this.config.socketPath}`,
              "CONNECTION_FAILED"
            )
          );
        } else if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
          handleReject(
            new ClawletError(
              `Connection refused: ${this.config.socketPath}`,
              "CONNECTION_FAILED"
            )
          );
        } else {
          handleReject(
            new ClawletError(
              `Socket error: ${err.message}`,
              "CONNECTION_FAILED",
              err
            )
          );
        }
      });

      socket.on("close", () => {
        clearTimeout(connectTimer);
        clearTimeout(requestTimer);
        // If we haven't resolved yet, treat as error
        handleReject(
          new ClawletError("Connection closed unexpectedly", "CONNECTION_FAILED")
        );
      });
    });
  }

  /**
   * Validate Ethereum address format
   */
  private validateAddress(address: string): void {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new ClawletError(
        `Invalid address format: ${address}`,
        "RPC_ERROR"
      );
    }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let globalClient: ClawletClient | null = null;

/**
 * Get or create the global ClawletClient instance
 */
export function getClawletClient(config?: ClawletClientConfig): ClawletClient {
  if (!globalClient) {
    globalClient = new ClawletClient(config);
  } else if (config) {
    // Update config if provided
    if (config.authToken) {
      globalClient.setAuthToken(config.authToken);
    }
  }
  return globalClient;
}

/**
 * Reset the global client (for testing)
 */
export function resetClawletClient(): void {
  globalClient = null;
}
