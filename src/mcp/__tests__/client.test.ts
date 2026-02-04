/**
 * MCP Client tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

// Mock child_process module
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks are set up
import { MCPClient, MCPError } from "./mcp-client.js";
import type { MCPServerConfig } from "./mcp-config.js";

/**
 * Create a mock child process
 */
function createMockProcess(): ChildProcess & {
  stdinWrite: (data: string) => void;
  emitStdout: (data: string) => void;
  emitExit: (code: number | null, signal: NodeJS.Signals | null) => void;
} {
  const stdin = new EventEmitter() as NodeJS.WritableStream & EventEmitter;
  const stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;

  const stdinData: string[] = [];
  stdin.write = vi.fn((data: string) => {
    stdinData.push(data);
    return true;
  }) as unknown as NodeJS.WritableStream["write"];

  const process = new EventEmitter() as ChildProcess & {
    stdinWrite: (data: string) => void;
    emitStdout: (data: string) => void;
    emitExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  };
  process.stdin = stdin as unknown as NodeJS.WritableStream;
  process.stdout = stdout as unknown as NodeJS.ReadableStream;
  process.stderr = stderr as unknown as NodeJS.ReadableStream;
  process.killed = false;
  process.kill = vi.fn(() => {
    (process as { killed: boolean }).killed = true;
    return true;
  });
  process.pid = 12345;

  // Helper to emit stdout line
  process.emitStdout = (data: string) => {
    stdout.emit("data", Buffer.from(data + "\n"));
  };

  // Helper to emit exit
  process.emitExit = (code: number | null, signal: NodeJS.Signals | null) => {
    process.emit("exit", code, signal);
  };

  // Helper to check stdin writes
  process.stdinWrite = (data: string) => {
    stdin.emit("data", data);
  };

  return process;
}

/**
 * Create a default server config for testing
 */
function createTestConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    command: "node",
    args: ["mock-server.js"],
    enabled: true,
    autoStart: true,
    restartOnCrash: true,
    security: { level: "write" },
    expose: { mode: "prefixed" },
    healthCheck: {
      enabled: false,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxFailures: 3,
    },
    restart: {
      maxAttempts: 3,
      backoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 1000,
    },
    timeouts: {
      startupMs: 1000,
      callMs: 1000,
      shutdownMs: 500,
    },
    ...overrides,
  };
}

describe("MCPClient", () => {
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start", () => {
    it("should spawn the process with correct arguments", async () => {
      const config = createTestConfig({
        command: "npx",
        args: ["@playwright/mcp@latest", "--headless"],
        env: { TEST_VAR: "test" },
        cwd: "/test/dir",
      });

      const client = new MCPClient("test", config);

      // Start but don't wait for it yet
      const startPromise = client.start();

      // Simulate server responding to tools/list
      const request = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(request.method).toBe("tools/list");

      // Emit response
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: [] },
      });
      mockProcess.stdout!.emit("data", Buffer.from(response + "\n"));

      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith("npx", ["@playwright/mcp@latest", "--headless"], {
        cwd: "/test/dir",
        env: expect.objectContaining({ TEST_VAR: "test" }),
        stdio: ["pipe", "pipe", "pipe"],
      });

      expect(client.isReady()).toBe(true);
    });

    it("should timeout if server does not respond", async () => {
      const config = createTestConfig({
        timeouts: { startupMs: 100, callMs: 100, shutdownMs: 100 },
      });

      const client = new MCPClient("test", config);
      const startPromise = client.start();

      // Advance timers past startup timeout
      await vi.advanceTimersByTimeAsync(150);

      await expect(startPromise).rejects.toThrow("timeout");
    });

    it("should emit ready event on successful start", async () => {
      const config = createTestConfig();
      const client = new MCPClient("test", config);

      const readyHandler = vi.fn();
      client.on("ready", readyHandler);

      const startPromise = client.start();

      // Respond to tools/list
      const request = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: [{ name: "test_tool", description: "Test", inputSchema: { type: "object" } }] },
      });
      mockProcess.stdout!.emit("data", Buffer.from(response + "\n"));

      await startPromise;

      expect(readyHandler).toHaveBeenCalled();
      expect(client.getTools()).toHaveLength(1);
    });
  });

  describe("callTool", () => {
    it("should send JSON-RPC request and return result", async () => {
      const config = createTestConfig();
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Call a tool
      const callPromise = client.callTool("test_tool", { arg1: "value1" });

      // Get the request
      const toolRequest = JSON.parse(
        (mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[1][0]
      );
      expect(toolRequest.method).toBe("tools/call");
      expect(toolRequest.params).toEqual({
        name: "test_tool",
        arguments: { arg1: "value1" },
      });

      // Send response
      const toolResponse = JSON.stringify({
        jsonrpc: "2.0",
        id: toolRequest.id,
        result: {
          content: [{ type: "text", text: "Success!" }],
          isError: false,
        },
      });
      mockProcess.stdout!.emit("data", Buffer.from(toolResponse + "\n"));

      const result = await callPromise;
      expect(result).toEqual({
        content: [{ type: "text", text: "Success!" }],
        isError: false,
      });
    });

    it("should timeout if server does not respond", async () => {
      const config = createTestConfig({
        timeouts: { startupMs: 1000, callMs: 100, shutdownMs: 100 },
      });
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Call a tool but don't respond
      const callPromise = client.callTool("test_tool", {});

      // Advance timers past call timeout
      await vi.advanceTimersByTimeAsync(150);

      await expect(callPromise).rejects.toThrow("timeout");
    });

    it("should reject with MCPError on JSON-RPC error", async () => {
      const config = createTestConfig();
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Call a tool
      const callPromise = client.callTool("test_tool", {});

      // Send error response
      const toolRequest = JSON.parse(
        (mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[1][0]
      );
      const errorResponse = JSON.stringify({
        jsonrpc: "2.0",
        id: toolRequest.id,
        error: {
          code: -32602,
          message: "Invalid params",
          data: { field: "arg1" },
        },
      });
      mockProcess.stdout!.emit("data", Buffer.from(errorResponse + "\n"));

      await expect(callPromise).rejects.toThrow(MCPError);
      await expect(callPromise).rejects.toThrow("invalid params");
    });

    it("should throw if client is not ready", async () => {
      const config = createTestConfig();
      const client = new MCPClient("test", config);

      await expect(client.callTool("test_tool", {})).rejects.toThrow("not ready");
    });
  });

  describe("stop", () => {
    it("should send SIGTERM and wait for exit", async () => {
      const config = createTestConfig();
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Stop the client
      const stopPromise = client.stop();

      // Simulate process exit
      mockProcess.emit("exit", 0, null);

      await stopPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
      expect(client.isReady()).toBe(false);
    });

    it("should reject pending calls when stopping", async () => {
      const config = createTestConfig();
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Start a tool call but don't complete it
      const callPromise = client.callTool("test_tool", {});

      // Stop the client
      const stopPromise = client.stop();
      mockProcess.emit("exit", 0, null);
      await stopPromise;

      await expect(callPromise).rejects.toThrow("stopping");
    });
  });

  describe("process crash", () => {
    it("should emit close event on unexpected exit", async () => {
      const config = createTestConfig({ restartOnCrash: false });
      const client = new MCPClient("test", config);

      const closeHandler = vi.fn();
      client.on("close", closeHandler);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Simulate crash
      mockProcess.emit("exit", 1, null);

      expect(closeHandler).toHaveBeenCalledWith(1, null);
    });

    it("should reject pending calls on crash", async () => {
      const config = createTestConfig({ restartOnCrash: false });
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Start a tool call
      const callPromise = client.callTool("test_tool", {});

      // Simulate crash
      mockProcess.emit("exit", 1, null);

      await expect(callPromise).rejects.toThrow("crashed");
    });

    it("should schedule restart on crash when configured", async () => {
      const config = createTestConfig({
        restartOnCrash: true,
        restart: { maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000 },
      });
      const client = new MCPClient("test", config);

      // Start the client
      const startPromise = client.start();
      let requestId = JSON.parse((mockProcess.stdin!.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).id;
      mockProcess.stdout!.emit(
        "data",
        Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { tools: [] } }) + "\n")
      );
      await startPromise;

      // Simulate crash
      mockProcess.emit("exit", 1, null);

      // Should schedule restart
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Advance timer to trigger restart
      const newMockProcess = createMockProcess();
      mockSpawn.mockReturnValue(newMockProcess);

      await vi.advanceTimersByTimeAsync(100);

      // Should have spawned again
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("MCPError", () => {
  it("should format error message correctly", () => {
    const error = new MCPError(-32602, "Missing required field");
    expect(error.message).toBe("MCP invalid params: Missing required field");
    expect(error.code).toBe(-32602);
  });

  it("should include data if provided", () => {
    const error = new MCPError(-32600, "Invalid request", { details: "test" });
    expect(error.data).toEqual({ details: "test" });
  });

  it("should map common error codes to labels", () => {
    expect(MCPError.codeToLabel(-32700)).toBe("parse error");
    expect(MCPError.codeToLabel(-32600)).toBe("invalid request");
    expect(MCPError.codeToLabel(-32601)).toBe("method not found");
    expect(MCPError.codeToLabel(-32602)).toBe("invalid params");
    expect(MCPError.codeToLabel(-32603)).toBe("internal error");
    expect(MCPError.codeToLabel(-32000)).toBe("error -32000");
  });
});
