/**
 * Clawlet HTTP Client
 *
 * Communicates with clawlet daemon via JSON-RPC 2.0.
 *
 * Clawlet's CLI (`clawlet serve --socket ...`) exposes a newline-delimited
 * JSON-RPC stream over a Unix domain socket (not HTTP).
 *
 * We also keep a legacy HTTP transport (baseUrl + /rpc) for compatibility
 * with older setups.
 * @see https://github.com/owliabot/clawlet
 */

import { createLogger } from "../utils/logger.js";
import { isInsideDocker } from "../logs/docker.js";
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";

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
  /** Optional: specific ERC-20 token addresses to query */
  tokens?: string[];
}

/** Single token balance */
export interface TokenBalance {
  /** Token symbol (e.g. "USDC") */
  symbol: string;
  /** Human-readable balance string */
  balance: string;
  /** Token contract address */
  address: string;
  /** Token decimals */
  decimals: number;
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
  /** Token type — "ETH" for native, or token symbol/contract address */
  token_type: string;
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

/** Send raw transaction request */
export interface SendRawRequest {
  /** Recipient address (0x-prefixed) */
  to: string;
  /** Value in wei (hex or decimal string) */
  value?: string;
  /** Calldata (0x-prefixed) */
  data?: string;
  /** Chain ID */
  chain_id: number;
  /** Gas limit */
  gas_limit?: number;
}

/** Send raw transaction response */
export interface SendRawResponse {
  /** Transaction hash */
  tx_hash: string;
  /** Audit event ID */
  audit_id: string;
}

/** Health check response */
export interface HealthResponse {
  status: "ok" | "error";
  version?: string;
}

/** Address query response */
export interface AddressResponse {
  /** Wallet address managed by Clawlet (0x-prefixed) */
  address: string;
}

/** Auth grant request */
export interface AuthGrantRequest {
  /** Admin password */
  password: string;
  /** Token scope: "read" or "trade" */
  scope: "read" | "trade" | "read,trade";
  /** Token TTL in hours (optional) */
  expires_hours?: number;
  /** Agent ID for audit (optional) */
  agent_id?: string;
  /** Label for the token */
  label?: string;
}

/** Auth grant response */
export interface AuthGrantResponse {
  /** The granted token (e.g., "clwt_xxx") */
  token: string;
  /** Token scope */
  scope: string;
  /** Expiration timestamp (ISO 8601) */
  expires_at?: string;
}

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
  /**
   * Authorization token for socket-mode JSON-RPC.
   * Typically "Bearer clwt_..." (Clawlet treats this similarly to HTTP Authorization).
   */
  authorization?: string;
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
  /** HTTP base URL (default: http://127.0.0.1:9100) */
  baseUrl?: string;
  /** Unix socket path (optional). If set, requests go over JSON-RPC via this socket. */
  socketPath?: string;
  /** Auth token for API calls (clwt_xxx format) */
  authToken?: string;
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number;
}

/** Client error types */
export class ClawletError extends Error {
  constructor(
    message: string,
    public code:
      | "CONNECTION_FAILED"
      | "TIMEOUT"
      | "UNAUTHORIZED"
      | "RPC_ERROR"
      | "INVALID_RESPONSE",
    public details?: unknown
  ) {
    super(message);
    this.name = "ClawletError";
  }
}

// ============================================================================
// Client Implementation
// ============================================================================

export const DEFAULT_BASE_URL = "http://127.0.0.1:9100";
const DOCKER_HOST_URL = "http://host.docker.internal:9100";
const DEFAULT_REQUEST_TIMEOUT = 30000;
const DEFAULT_RPC_PATH = "/rpc";

/**
 * Resolve the Clawlet base URL, auto-detecting Docker environment.
 *
 * - If the user explicitly configured a non-default URL, use it as-is.
 * - If we're inside Docker and no custom URL was set, use `host.docker.internal`.
 * - Otherwise, fall back to `127.0.0.1`.
 */
export function resolveClawletBaseUrl(configBaseUrl?: string): string {
  // User explicitly set a custom (non-default) URL → respect it
  if (configBaseUrl && configBaseUrl !== DEFAULT_BASE_URL) {
    log.info(`Clawlet baseUrl: ${configBaseUrl} (user-configured)`);
    return configBaseUrl;
  }

  // Auto-detect Docker
  if (isInsideDocker()) {
    log.info(`Clawlet baseUrl: ${DOCKER_HOST_URL} (Docker auto-detected)`);
    return DOCKER_HOST_URL;
  }

  log.debug(`Clawlet baseUrl: ${DEFAULT_BASE_URL} (default)`);
  return DEFAULT_BASE_URL;
}
const NEWLINE = "\n";

/**
 * Clawlet HTTP Client
 *
 * Example usage:
 * ```typescript
 * const client = new ClawletClient({
 *   baseUrl: "http://127.0.0.1:9100",
 *   authToken: "clwt_your-token-here"
 * });
 *
 * // Get wallet address
 * const { address } = await client.address();
 *
 * // Query balance
 * const balance = await client.balance({
 *   address: "0x...",
 *   chain_id: 8453
 * });
 * ```
 */
export class ClawletClient extends EventEmitter {
  private config: Required<Omit<ClawletClientConfig, "authToken" | "socketPath">> & {
    authToken: string;
    socketPath?: string;
  };
  private requestId = 0;

  constructor(config: ClawletClientConfig = {}) {
    super();
    this.config = {
      baseUrl: resolveClawletBaseUrl(config.baseUrl),
      socketPath: config.socketPath,
      authToken: config.authToken ?? "",
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
   * Update the HTTP base URL.
   * Note: ignored when socketPath is set.
   */
  setBaseUrl(baseUrl: string): void {
    this.config.baseUrl = baseUrl;
  }

  /**
   * Update the Unix socket path.
   * When set, requests will go over this socket instead of TCP baseUrl.
   */
  setSocketPath(socketPath: string | undefined): void {
    this.config.socketPath = socketPath;
  }

  /**
   * Update request timeout in ms.
   */
  setRequestTimeout(requestTimeout: number): void {
    this.config.requestTimeout = requestTimeout;
  }

  /**
   * Get the current auth token
   */
  getAuthToken(): string {
    return this.config.authToken;
  }

  /**
   * Health check — does not require auth
   */
  async health(): Promise<HealthResponse> {
    return this.call<HealthResponse>("health", undefined, false);
  }

  /**
   * Get wallet address managed by Clawlet — does not require auth
   */
  async address(): Promise<AddressResponse> {
    return this.call<AddressResponse>("address", undefined, false);
  }

  /**
   * Grant an auth token using admin password
   * Does not require existing auth token
   */
  async authGrant(req: AuthGrantRequest): Promise<AuthGrantResponse> {
    const response = await this.call<AuthGrantResponse>(
      "auth.grant",
      [req],
      false
    );
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
    return this.call<BalanceResponse>("balance", [query]);
  }

  /**
   * Send a raw transaction
   * Requires: Trade scope token
   */
  async sendRaw(req: SendRawRequest): Promise<SendRawResponse> {
    this.validateAddress(req.to);
    return this.call<SendRawResponse>("send_raw", [req]);
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
    return this.call<TransferResponse>("transfer", [req]);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Make a JSON-RPC call over HTTP
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

    const response = await this.sendRequest<T>(request, requireAuth);
    return response;
  }

  /**
   * Send HTTP request and parse JSON-RPC response
   */
  private async sendRequest<T>(
    request: JsonRpcRequest,
    requireAuth: boolean
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeout);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (requireAuth && this.config.authToken) {
        headers["Authorization"] = `Bearer ${this.config.authToken}`;
      }

      if (this.config.socketPath) {
        const authorization = this.config.authToken.startsWith("Bearer ")
          ? this.config.authToken
          : `Bearer ${this.config.authToken}`;

        const requestWithAuth: JsonRpcRequest =
          requireAuth && this.config.authToken
            ? { ...request, authorization }
            : request;

        log.debug(`Sending request to unix://${this.config.socketPath}: ${request.method}`);
        return await this.sendUnixSocketRequest<T>({
          socketPath: this.config.socketPath,
          body: JSON.stringify(requestWithAuth),
          timeoutMs: this.config.requestTimeout,
          signal: controller.signal,
        });
      }

      log.debug(`Sending request to ${this.config.baseUrl}${DEFAULT_RPC_PATH}: ${request.method}`);

      const response = await fetch(`${this.config.baseUrl}${DEFAULT_RPC_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new ClawletError("Unauthorized", "UNAUTHORIZED");
        }
        throw new ClawletError(
          `HTTP error: ${response.status} ${response.statusText}`,
          "RPC_ERROR"
        );
      }

      const jsonResponse = (await response.json()) as JsonRpcResponse<T>;

      if (jsonResponse.error) {
        // Map error codes
        const code =
          jsonResponse.error.code === -32001 ? "UNAUTHORIZED" : "RPC_ERROR";

        throw new ClawletError(
          jsonResponse.error.message,
          code,
          jsonResponse.error.data
        );
      }

      if (jsonResponse.result === undefined) {
        throw new ClawletError("No result in response", "INVALID_RESPONSE");
      }

      return jsonResponse.result;
    } catch (err) {
      if (err instanceof ClawletError) {
        throw err;
      }

      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new ClawletError(
            `Request timeout after ${this.config.requestTimeout}ms`,
            "TIMEOUT"
          );
        }

        // Network errors
        if (
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("fetch failed")
        ) {
          throw new ClawletError(
            `Connection refused: ${this.config.baseUrl}`,
            "CONNECTION_FAILED"
          );
        }

        throw new ClawletError(
          `Request failed: ${err.message}`,
          "CONNECTION_FAILED",
          err
        );
      }

      throw new ClawletError(
        `Unknown error: ${String(err)}`,
        "CONNECTION_FAILED"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send a JSON-RPC request over HTTP via Unix socket.
   *
   * This is used when Clawlet is running in socket mode (`clawlet serve --socket ...`).
   */
  private async sendUnixSocketRequest<T>(args: {
    socketPath: string;
    body: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;

      const safeReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const safeResolve = (val: T) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };

      const socket = createConnection({ path: args.socketPath });

      // Timeout
      const timeoutId = setTimeout(() => {
        socket.destroy(new Error("AbortError"));
      }, args.timeoutMs);

      // Abort support (from the fetch-style controller)
      const onAbort = () => {
        socket.destroy(new Error("AbortError"));
      };
      if (args.signal.aborted) {
        onAbort();
      } else {
        args.signal.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = () => {
        clearTimeout(timeoutId);
        args.signal.removeEventListener("abort", onAbort);
        socket.removeAllListeners();
      };

      let buffer = "";

      socket.on("connect", () => {
        socket.write(args.body + NEWLINE);
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");

        const idx = buffer.indexOf(NEWLINE);
        if (idx < 0) return;

        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);

        // We got one response line; close and parse.
        socket.end();
        cleanup();

        try {
          const jsonResponse = JSON.parse(line) as JsonRpcResponse<T>;

          if (jsonResponse.error) {
            const code =
              jsonResponse.error.code === -32001 ? "UNAUTHORIZED" : "RPC_ERROR";

            safeReject(
              new ClawletError(
                jsonResponse.error.message,
                code,
                jsonResponse.error.data
              )
            );
            return;
          }

          if (jsonResponse.result === undefined) {
            safeReject(
              new ClawletError("No result in response", "INVALID_RESPONSE")
            );
            return;
          }

          safeResolve(jsonResponse.result);
        } catch (e) {
          safeReject(
            new ClawletError(
              `Invalid JSON response: ${(e as Error).message}`,
              "INVALID_RESPONSE"
            )
          );
        }
      });

      socket.on("error", (err: NodeJS.ErrnoException) => {
        cleanup();

        if (err.message === "AbortError") {
          safeReject(
            new ClawletError(`Request timeout after ${args.timeoutMs}ms`, "TIMEOUT")
          );
          return;
        }

        if (err.code === "EPERM" || err.code === "EACCES") {
          safeReject(
            new ClawletError(
              `Socket permission denied: ${args.socketPath}`,
              "CONNECTION_FAILED",
              err
            )
          );
          return;
        }

        if (err.code === "ENOENT") {
          safeReject(
            new ClawletError(
              `Socket not found: ${args.socketPath}`,
              "CONNECTION_FAILED",
              err
            )
          );
          return;
        }

        safeReject(
          new ClawletError(
            `Request failed: ${err.message}`,
            "CONNECTION_FAILED",
            err
          )
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
    if (config.baseUrl) {
      globalClient.setBaseUrl(config.baseUrl);
    }
    if (config.socketPath) {
      globalClient.setSocketPath(config.socketPath);
    }
    if (config.requestTimeout) {
      globalClient.setRequestTimeout(config.requestTimeout);
    }
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
