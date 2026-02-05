/**
 * ClawletClient Unit Tests
 *
 * Tests for the Unix socket JSON-RPC client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  ClawletClient,
  ClawletError,
  resetClawletClient,
  getClawletClient,
} from "../clawlet-client.js";

// Use vi.hoisted to ensure the mock function is available during hoisting
const { mockCreateConnection } = vi.hoisted(() => {
  return { mockCreateConnection: vi.fn() };
});

// Mock net.createConnection
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    createConnection: mockCreateConnection,
  };
});

/**
 * Create a mock socket for testing
 */
function createMockSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };
  socket.write = vi.fn();
  socket.destroy = vi.fn();
  socket.removeAllListeners = vi.fn();
  return socket;
}

describe("ClawletClient", () => {
  let mockSocket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetClawletClient();
    mockSocket = createMockSocket();
    mockCreateConnection.mockReturnValue(mockSocket as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("JSON-RPC serialization", () => {
    it("should serialize request with correct JSON-RPC format", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      // Setup mock response
      setTimeout(() => {
        mockSocket.emit("connect");
      }, 10);

      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          result: { eth: "1.0", tokens: [] },
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 20);

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      // Verify request format
      expect(mockSocket.write).toHaveBeenCalledTimes(1);
      const writtenData = mockSocket.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(writtenData.trim());

      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("balance");
      expect(parsed.params).toEqual({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });
      expect(parsed.id).toBe(1);
      expect(parsed.meta.authorization).toBe("Bearer test-token");
    });

    it("should increment request ID for each call", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      // First request
      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        mockSocket.emit(
          "data",
          Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", result: { eth: "1.0", tokens: [] }, id: 1 }) + "\n"
          )
        );
      }, 10);

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      const firstId = JSON.parse((mockSocket.write.mock.calls[0][0] as string).trim()).id;

      // Second request - need new mock socket
      mockSocket = createMockSocket();
      mockCreateConnection.mockReturnValue(mockSocket as any);

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        mockSocket.emit(
          "data",
          Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", result: { eth: "2.0", tokens: [] }, id: 2 }) + "\n"
          )
        );
      }, 10);

      await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 1,
      });

      const secondId = JSON.parse((mockSocket.write.mock.calls[0][0] as string).trim()).id;

      expect(secondId).toBe(firstId + 1);
    });
  });

  describe("successful response parsing", () => {
    it("should parse balance response correctly", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          result: {
            eth: "1.5",
            tokens: [
              { symbol: "USDC", balance: "100.0", address: "0xUSDC" },
            ],
          },
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 10);

      const result = await client.balance({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });

      expect(result.eth).toBe("1.5");
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].symbol).toBe("USDC");
      expect(result.tokens[0].balance).toBe("100.0");
    });

    it("should parse transfer response correctly", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          result: {
            status: "success",
            tx_hash: "0xabc123",
            audit_id: "audit-456",
          },
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 10);

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
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          result: { status: "ok", version: "1.0.0" },
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 10);

      const result = await client.health();

      expect(result.status).toBe("ok");
      expect(result.version).toBe("1.0.0");

      // Verify no auth header for health
      const writtenData = mockSocket.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(writtenData.trim());
      expect(parsed.meta).toBeUndefined();
    });
  });

  describe("error response handling", () => {
    it("should throw ClawletError on RPC error", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid request",
          },
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 10);

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
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized",
          },
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 10);

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
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
        });
        mockSocket.emit("data", Buffer.from(response + "\n"));
      }, 10);

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

    it("should throw on malformed JSON", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        mockSocket.emit("data", Buffer.from("not valid json\n"));
      }, 10);

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
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        mockSocket.emit(
          "data",
          Buffer.from(JSON.stringify({ jsonrpc: "2.0", result: { eth: "1.0", tokens: [] }, id: 1 }) + "\n")
        );
      }, 10);

      // Valid address with uppercase
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
    it("should timeout on connection", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 50,
        requestTimeout: 100,
      });

      // Don't emit connect - let it timeout

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("TIMEOUT");
        expect((err as ClawletError).message).toContain("Connection timeout");
      }
    }, 1000);

    it("should timeout on request", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 50,
      });

      // Connect but don't respond
      setTimeout(() => mockSocket.emit("connect"), 5);

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("TIMEOUT");
        expect((err as ClawletError).message).toContain("Request timeout");
      }
    }, 1000);
  });

  describe("connection error handling", () => {
    it("should handle ENOENT (socket not found)", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        socketPath: "/nonexistent/path.sock",
        connectTimeout: 100,
      });

      setTimeout(() => {
        const error = new Error("Socket not found") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        mockSocket.emit("error", error);
      }, 5);

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("CONNECTION_FAILED");
        expect((err as ClawletError).message).toContain("Socket not found");
      }
    });

    it("should handle ECONNREFUSED", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
      });

      setTimeout(() => {
        const error = new Error("Connection refused") as NodeJS.ErrnoException;
        error.code = "ECONNREFUSED";
        mockSocket.emit("error", error);
      }, 5);

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("CONNECTION_FAILED");
        expect((err as ClawletError).message).toContain("Connection refused");
      }
    });

    it("should handle unexpected close", async () => {
      const client = new ClawletClient({
        authToken: "test-token",
        connectTimeout: 100,
        requestTimeout: 100,
      });

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => mockSocket.emit("close"), 15);

      try {
        await client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClawletError);
        expect((err as ClawletError).code).toBe("CONNECTION_FAILED");
        expect((err as ClawletError).message).toContain("closed unexpectedly");
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
      const client = new ClawletClient({ connectTimeout: 100, requestTimeout: 100 });

      // Initially no token
      await expect(
        client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).rejects.toThrow();

      // Set token
      client.setAuthToken("new-token");

      setTimeout(() => mockSocket.emit("connect"), 5);
      setTimeout(() => {
        mockSocket.emit(
          "data",
          Buffer.from(JSON.stringify({ jsonrpc: "2.0", result: { eth: "1.0", tokens: [] }, id: 2 }) + "\n")
        );
      }, 10);

      // Should work now
      await expect(
        client.balance({
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        })
      ).resolves.toBeDefined();
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
});
