/**
 * ClawletClient Unit Tests
 *
 * Tests for the HTTP JSON-RPC client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ClawletClient,
  ClawletError,
  resetClawletClient,
  getClawletClient,
  resolveClawletBaseUrl,
  DEFAULT_BASE_URL,
} from "../clawlet-client.js";

// Mock isInsideDocker
vi.mock("../resolve-host.js", () => ({
  canResolveHost: vi.fn(() => false),
}));

vi.mock("../../logs/docker.js", () => ({
  isInsideDocker: vi.fn(() => false),
}));

import { isInsideDocker } from "../../logs/docker.js";
import { canResolveHost } from "../resolve-host.js";
const mockedCanResolveHost = vi.mocked(canResolveHost);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/**
 * Helper to create a mock Response
 */
function createMockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "http://127.0.0.1:9100/rpc",
    clone: () => createMockResponse(body, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(body),
    bytes: async () => new Uint8Array(),
  } as Response;
}

describe("ClawletClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClawletClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("JSON-RPC serialization", () => {
    it("should serialize request with correct JSON-RPC format", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: { eth: "1.0", tokens: [] },
          id: 1,
        })
      );

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      
      expect(url).toBe("http://127.0.0.1:9100/rpc");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["Authorization"]).toBe("Bearer test-token");

      const parsed = JSON.parse(options.body);
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("balance");
      expect(parsed.params).toEqual([{
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      }]);
      expect(parsed.id).toBe(1);
    });

    it("should increment request ID for each call", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValue(
        createMockResponse({
          jsonrpc: "2.0",
          result: { eth: "1.0", tokens: [] },
          id: 1,
        })
      );

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 1,
      });

      const firstId = JSON.parse(mockFetch.mock.calls[0][1].body).id;
      const secondId = JSON.parse(mockFetch.mock.calls[1][1].body).id;

      expect(secondId).toBe(firstId + 1);
    });
  });

  describe("successful response parsing", () => {
    it("should parse balance response correctly", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: {
            eth: "1.5",
            tokens: [
              { symbol: "USDC", balance: "100.0", address: "0xUSDC", decimals: 6 },
            ],
          },
          id: 1,
        })
      );

      const result = await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      expect(result.eth).toBe("1.5");
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].symbol).toBe("USDC");
      expect(result.tokens[0].balance).toBe("100.0");
      expect(result.tokens[0].decimals).toBe(6);
    });

    it("should parse transfer response correctly", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: {
            status: "success",
            tx_hash: "0xabc123",
            audit_id: "audit-456",
          },
          id: 1,
        })
      );

      const result = await client.transfer({
        to: "0x1234567890123456789012345678901234567890",
        amount: "1.0",
        token: "ETH",
        chain_id: 8453,
      });

      expect(result.status).toBe("success");
      expect(result.tx_hash).toBe("0xabc123");
      expect(result.audit_id).toBe("audit-456");
    });

    it("should parse health response without auth", async () => {
      const client = new ClawletClient({
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: { status: "ok", version: "1.0.0" },
          id: 1,
        })
      );

      const result = await client.health();

      expect(result.status).toBe("ok");
      expect(result.version).toBe("1.0.0");

      // Verify no auth header for health
      const options = mockFetch.mock.calls[0][1];
      expect(options.headers["Authorization"]).toBeUndefined();
    });

    it("should parse address response without auth", async () => {
      const client = new ClawletClient({
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: { address: "0x742d35cc6634c0532925a3b844bc9e7595f5b5e2" },
          id: 1,
        })
      );

      const result = await client.address();

      expect(result.address).toBe("0x742d35cc6634c0532925a3b844bc9e7595f5b5e2");

      // Verify no auth header for address
      const options = mockFetch.mock.calls[0][1];
      expect(options.headers["Authorization"]).toBeUndefined();
    });
  });

  describe("error response handling", () => {
    it("should throw ClawletError on RPC error", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid request",
          },
          id: 1,
        })
      );

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("RPC_ERROR");
        expect((err as ClawletError).message).toBe("Invalid request");
      }
    });

    it("should map -32001 to UNAUTHORIZED error", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized",
          },
          id: 1,
        })
      );

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("UNAUTHORIZED");
      }
    });

    it("should throw on HTTP 401", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: "Unauthorized" }, 401)
      );

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("UNAUTHORIZED");
      }
    });

    it("should throw on missing result", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          id: 1,
        })
      );

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("INVALID_RESPONSE");
      }
    });
  });

  describe("address validation", () => {
    it("should accept valid 0x-prefixed address", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: { eth: "1.0", tokens: [] },
          id: 1,
        })
      );

      await expect(
        client.balance({
          address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
          chain_id: 8453,
        })
      ).resolves.toBeDefined();
    });

    it("should reject address without 0x prefix", async () => {
      const client = new ClawletClient({ authToken: "test-token" });

      await expect(
        client.balance({
          address: "1234567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);

      try {
        await client.balance({
          address: "1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
      } catch (err) {
        expect((err as ClawletError).code).toBe("RPC_ERROR");
        expect((err as ClawletError).message).toContain("Invalid address");
      }
    });

    it("should reject address with wrong length", async () => {
      const client = new ClawletClient({ authToken: "test-token" });

      await expect(
        client.balance({
          address: "0x1234",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);
    });

    it("should reject address with invalid characters", async () => {
      const client = new ClawletClient({ authToken: "test-token" });

      await expect(
        client.balance({
          address: "0xGGGG567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);
    });

    it("should reject empty address", async () => {
      const client = new ClawletClient({ authToken: "test-token" });

      await expect(
        client.balance({
          address: "",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);
    });
  });

  describe("amount validation for transfers", () => {
    it("should reject invalid amount", async () => {
      const client = new ClawletClient({ authToken: "test-token" });

      await expect(
        client.transfer({
          to: "0x1234567890123456789012345678901234567890",
          amount: "not-a-number",
          token: "ETH",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);
    });

    it("should reject empty amount", async () => {
      const client = new ClawletClient({ authToken: "test-token" });

      await expect(
        client.transfer({
          to: "0x1234567890123456789012345678901234567890",
          amount: "",
          token: "ETH",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);
    });
  });

  describe("timeout handling", () => {
    it("should timeout on request", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 50,
      });

      // Mock fetch that respects AbortSignal
      mockFetch.mockImplementationOnce((_url: string, options: { signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(createMockResponse({})), 200);
          
          // Listen for abort
          options?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const abortError = new Error("The operation was aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      });

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("TIMEOUT");
        expect((err as ClawletError).message).toContain("timeout");
      }
    }, 1000);
  });

  describe("connection error handling", () => {
    it("should handle fetch failure (connection refused)", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockRejectedValueOnce(new Error("fetch failed: ECONNREFUSED"));

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("CONNECTION_FAILED");
      }
    });

    it("should handle network errors", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("CONNECTION_FAILED");
      }
    });
  });

  describe("auth token handling", () => {
    it("should throw UNAUTHORIZED when no token for auth-required call", async () => {
      const client = new ClawletClient();

      await expect(
        client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).rejects.toThrow(ClawletError);

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
      } catch (err) {
        expect((err as ClawletError).code).toBe("UNAUTHORIZED");
      }
    });

    it("should allow setAuthToken to update token", async () => {
      const client = new ClawletClient({ requestTimeout: 5000 });

      // Initially no token
      await expect(
        client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).rejects.toThrow();

      // Set token
      client.setAuthToken("new-token");

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: { eth: "1.0", tokens: [] },
          id: 1,
        })
      );

      // Should work now
      await expect(
        client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).resolves.toBeDefined();
    });

    it("should return token with getAuthToken", () => {
      const client = new ClawletClient({ authToken: "test-token" });
      expect(client.getAuthToken()).toBe("test-token");
    });
  });

  describe("custom base URL", () => {
    it("should use custom base URL", async () => {
      const client = new ClawletClient({
        baseUrl: "http://192.168.1.100:8080",
        authToken: "test-token",
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: { eth: "1.0", tokens: [] },
          id: 1,
        })
      );

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("http://192.168.1.100:8080/rpc");
    });
  });

  describe("singleton factory", () => {
    it("should return same instance from getClawletClient", () => {
      resetClawletClient();
      const client1 = getClawletClient({ authToken: "token1" });
      const client2 = getClawletClient({ authToken: "token2" });

      expect(client1).toBe(client2);
    });

    it("should reset client with resetClawletClient", () => {
      const client1 = getClawletClient({ authToken: "token1" });
      resetClawletClient();
      const client2 = getClawletClient({ authToken: "token2" });

      expect(client1).not.toBe(client2);
    });
  });

  describe("resolveClawletBaseUrl", () => {
    const mockedIsInsideDocker = vi.mocked(isInsideDocker);

    beforeEach(() => {
      mockedIsInsideDocker.mockReturnValue(false);
    });

    it("should return default URL when not in Docker and no config", () => {
      expect(resolveClawletBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    it("should respect explicitly provided default URL (no override)", () => {
      expect(resolveClawletBaseUrl(DEFAULT_BASE_URL)).toBe(DEFAULT_BASE_URL);
    });

    it("should return docker host URL when inside Docker and host resolves", () => {
      mockedIsInsideDocker.mockReturnValue(true);
      mockedCanResolveHost.mockReturnValue(true);
      expect(resolveClawletBaseUrl()).toBe("http://host.docker.internal:9100");
    });

    it("should fallback to bridge URL when inside Docker and host does not resolve", () => {
      mockedIsInsideDocker.mockReturnValue(true);
      mockedCanResolveHost.mockReturnValue(false);
      expect(resolveClawletBaseUrl()).toBe("http://172.17.0.1:9100");
    });

    it("should respect explicitly provided default URL inside Docker (no override)", () => {
      mockedIsInsideDocker.mockReturnValue(true);
      expect(resolveClawletBaseUrl(DEFAULT_BASE_URL)).toBe(DEFAULT_BASE_URL);
    });

    it("should respect custom URL even inside Docker", () => {
      mockedIsInsideDocker.mockReturnValue(true);
      expect(resolveClawletBaseUrl("http://custom:9100")).toBe("http://custom:9100");
    });

    it("should respect custom URL when not in Docker", () => {
      expect(resolveClawletBaseUrl("http://custom:9100")).toBe("http://custom:9100");
    });
  });

  describe("chains", () => {
    it("should return supported chains without auth", async () => {
      const client = new ClawletClient({
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: [
            { chain_id: 8453, name: "Base" },
            { chain_id: 1, name: "Ethereum Mainnet" },
            { chain_id: 11155111, name: "Sepolia", testnet: true },
          ],
          id: 1,
        })
      );

      const result = await client.chains();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ chain_id: 8453, name: "Base" });
      expect(result[2]).toEqual({ chain_id: 11155111, name: "Sepolia", testnet: true });

      // Verify no auth header for chains
      const options = mockFetch.mock.calls[0][1];
      expect(options.headers["Authorization"]).toBeUndefined();
    });
  });

  describe("authGrant", () => {
    it("should grant token and auto-set it", async () => {
      const client = new ClawletClient({
        requestTimeout: 5000,
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          jsonrpc: "2.0",
          result: {
            token: "clwt_new_token_123",
            scope: "read,trade",
            expires_at: "2026-12-31T23:59:59Z",
          },
          id: 1,
        })
      );

      const result = await client.authGrant({
        password: "admin-password",
        scope: "read,trade",
        label: "my-agent",
      });

      expect(result.token).toBe("clwt_new_token_123");
      expect(result.scope).toBe("read,trade");
      
      // Token should be auto-set
      expect(client.getAuthToken()).toBe("clwt_new_token_123");
    });
  });
});
