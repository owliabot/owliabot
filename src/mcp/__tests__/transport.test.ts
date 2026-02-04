/**
 * Transport unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

// Hoisted mocks - must be declared before any imports that use them
const mockSpawn = vi.hoisted(() => vi.fn());
const mockCreateInterface = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:readline", () => ({
  createInterface: mockCreateInterface,
}));

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks are set up
import { StdioTransport, createTransport } from "../transport.js";
import { MCPError, MCPErrorCode } from "../types.js";

// Helper to create mock streams with proper implementation
function createMockStdin() {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      callback();
      return true;
    },
  });
  stdin.end = vi.fn();
  return stdin;
}

function createMockStdout() {
  return new Readable({
    read() {},
  });
}

function createMockStderr() {
  return new Readable({
    read() {},
  });
}

// Helper to create a mock child process
function createMockProcess(): {
  process: ChildProcess;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  readline: EventEmitter;
} {
  const stdin = createMockStdin();
  const stdout = createMockStdout();
  const stderr = createMockStderr();
  const readline = new EventEmitter();

  const proc = new EventEmitter() as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdin = stdin;
  (proc as unknown as Record<string, unknown>).stdout = stdout;
  (proc as unknown as Record<string, unknown>).stderr = stderr;
  (proc as unknown as Record<string, unknown>).killed = false;
  proc.kill = vi.fn((signal?: string) => {
    if (signal === "SIGKILL") {
      (proc as unknown as Record<string, unknown>).killed = true;
    }
    return true;
  });

  // Mock readline
  (readline as unknown as Record<string, unknown>).close = vi.fn();
  mockCreateInterface.mockReturnValue(readline);

  return { process: proc, stdin, stdout, stderr, readline };
}

describe("StdioTransport", () => {
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess.process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("connect", () => {
    it("spawns process with correct command and args", async () => {
      const transport = new StdioTransport({
        command: "/usr/bin/test-server",
        args: ["--port", "3000"],
        env: { TEST_VAR: "value" },
        cwd: "/tmp",
      });

      // Emit spawn event after connect is called
      setTimeout(() => mockProcess.process.emit("spawn"), 10);

      await transport.connect();

      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/bin/test-server",
        ["--port", "3000"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
          env: expect.objectContaining({ TEST_VAR: "value" }),
          cwd: "/tmp",
          shell: false,
        })
      );
    });

    it("sets connected state after successful spawn", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      expect(transport.isConnected()).toBe(false);

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      expect(transport.isConnected()).toBe(true);
    });

    it("sets health status to healthy after connect", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      expect(transport.getHealthStatus()).toBe("unknown");

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      expect(transport.getHealthStatus()).toBe("healthy");
    });

    it("rejects on spawn error", async () => {
      const transport = new StdioTransport({ command: "nonexistent" });

      setTimeout(() => {
        mockProcess.process.emit("error", new Error("spawn ENOENT"));
      }, 10);

      await expect(transport.connect()).rejects.toThrow(MCPError);
    });

    it("rejects on connection timeout", async () => {
      const transport = new StdioTransport({
        command: "slow-server",
        connectTimeout: 50,
      });

      // Never emit spawn event - should timeout
      await expect(transport.connect()).rejects.toThrow(/timeout/i);
    });
  });

  describe("send", () => {
    it("throws when not connected", () => {
      const transport = new StdioTransport({ command: "test-server" });

      expect(() =>
        transport.send({ jsonrpc: "2.0", id: 1, method: "test" })
      ).toThrow(MCPError);
    });

    it("writes JSON message to stdin with newline", async () => {
      const transport = new StdioTransport({ command: "test-server" });
      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      const writeSpy = vi.spyOn(mockProcess.stdin, "write");
      const message = { jsonrpc: "2.0" as const, id: 1, method: "test" };
      transport.send(message);

      expect(writeSpy).toHaveBeenCalledWith(
        JSON.stringify(message) + "\n",
        expect.any(Function)
      );
    });
  });

  describe("message receiving", () => {
    it("parses JSON lines and invokes callback", async () => {
      const transport = new StdioTransport({ command: "test-server" });
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      // Simulate readline emitting a line
      const message = { jsonrpc: "2.0", id: 1, result: { success: true } };
      mockProcess.readline.emit("line", JSON.stringify(message));

      expect(messageCallback).toHaveBeenCalledWith(message);
    });

    it("handles parse errors gracefully", async () => {
      const transport = new StdioTransport({ command: "test-server" });
      const errorCallback = vi.fn();
      transport.onError(errorCallback);

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      // Emit invalid JSON
      mockProcess.readline.emit("line", "not valid json");

      expect(errorCallback).toHaveBeenCalled();
      expect(errorCallback.mock.calls[0][0]).toBeInstanceOf(MCPError);
    });
  });

  describe("close", () => {
    it("sends SIGTERM first for graceful shutdown", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      // Process exits immediately after SIGTERM
      const closePromise = transport.close();
      setTimeout(() => mockProcess.process.emit("exit", 0, "SIGTERM"), 10);
      await closePromise;

      expect(mockProcess.process.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("sends SIGKILL if process does not exit gracefully", async () => {
      // Override the static timeout for faster test
      const originalTimeout = StdioTransport.GRACEFUL_SHUTDOWN_TIMEOUT_MS;
      (StdioTransport as unknown as Record<string, number>).GRACEFUL_SHUTDOWN_TIMEOUT_MS = 50;

      try {
        const transport = new StdioTransport({ command: "stubborn-server" });

        setTimeout(() => mockProcess.process.emit("spawn"), 10);
        await transport.connect();

        // Process never exits - should get SIGKILL after timeout
        await transport.close();

        expect(mockProcess.process.kill).toHaveBeenCalledWith("SIGTERM");
        expect(mockProcess.process.kill).toHaveBeenCalledWith("SIGKILL");
      } finally {
        (StdioTransport as unknown as Record<string, number>).GRACEFUL_SHUTDOWN_TIMEOUT_MS = originalTimeout;
      }
    });

    it("closes stdin before sending SIGTERM", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      const closePromise = transport.close();
      setTimeout(() => mockProcess.process.emit("exit", 0), 10);
      await closePromise;

      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it("is idempotent - multiple calls resolve together", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      // Start closing without letting it finish
      const promise1 = transport.close();
      const promise2 = transport.close();

      // Let it finish
      mockProcess.process.emit("exit", 0);
      
      // Both promises should resolve
      await Promise.all([promise1, promise2]);
      
      // Transport should be disconnected
      expect(transport.isConnected()).toBe(false);
    });

    it("resets health status to unknown after close", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();
      expect(transport.getHealthStatus()).toBe("healthy");

      const closePromise = transport.close();
      setTimeout(() => mockProcess.process.emit("exit", 0), 10);
      await closePromise;

      expect(transport.getHealthStatus()).toBe("unknown");
    });
  });

  describe("health status", () => {
    it("returns unknown when not connected", () => {
      const transport = new StdioTransport({ command: "test-server" });
      expect(transport.getHealthStatus()).toBe("unknown");
    });

    it("returns healthy after successful connection", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      expect(transport.getHealthStatus()).toBe("healthy");
    });

    it("can be marked unhealthy", async () => {
      const transport = new StdioTransport({ command: "test-server" });

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      transport.markUnhealthy("repeated failures");
      expect(transport.getHealthStatus()).toBe("unhealthy");
    });
  });

  describe("error handling", () => {
    it("invokes error callback on process error after connect", async () => {
      const transport = new StdioTransport({ command: "test-server" });
      const errorCallback = vi.fn();
      transport.onError(errorCallback);

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      const error = new Error("process crashed");
      mockProcess.process.emit("error", error);

      expect(errorCallback).toHaveBeenCalledWith(error);
    });

    it("invokes close callback on process exit", async () => {
      const transport = new StdioTransport({ command: "test-server" });
      const closeCallback = vi.fn();
      transport.onClose(closeCallback);

      setTimeout(() => mockProcess.process.emit("spawn"), 10);
      await transport.connect();

      mockProcess.process.emit("exit", 1, null);

      expect(closeCallback).toHaveBeenCalledWith(1);
    });
  });
});

describe("createTransport", () => {
  it("creates StdioTransport for stdio config", () => {
    const transport = createTransport({
      name: "test",
      transport: "stdio",
      command: "/usr/bin/test-server",
      args: ["--flag"],
    });

    expect(transport).toBeInstanceOf(StdioTransport);
  });

  it("throws for stdio config without command", () => {
    expect(() =>
      createTransport({
        name: "test",
        transport: "stdio",
      } as never)
    ).toThrow(MCPError);
  });

  it("throws for sse config without url", () => {
    expect(() =>
      createTransport({
        name: "test",
        transport: "sse",
      } as never)
    ).toThrow(MCPError);
  });

  it("passes connectTimeout from defaults", () => {
    const transport = createTransport(
      {
        name: "test",
        transport: "stdio",
        command: "test-server",
      },
      { connectTimeout: 5000 }
    );

    expect(transport).toBeInstanceOf(StdioTransport);
  });
});
