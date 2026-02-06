/**
 * CLI Runner Tests
 * Tests for CLI agent execution, argument building, and output parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter, Readable, Writable } from "node:stream";

// Mock child_process.spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocking
import { runCliAgent, isCliCommandAvailable } from "./cli-runner.js";
import { isCliProvider, resolveCliBackendConfig, resolveCliModel } from "./cli-provider.js";
import { DEFAULT_CLAUDE_BACKEND, normalizeProviderId } from "./cli-backends.js";

describe("normalizeProviderId", () => {
  it("should lowercase and normalize underscores to hyphens", () => {
    expect(normalizeProviderId("Claude_CLI")).toBe("claude-cli");
    expect(normalizeProviderId("CODEX-CLI")).toBe("codex-cli");
    expect(normalizeProviderId("claude-cli")).toBe("claude-cli");
  });
});

describe("isCliProvider", () => {
  it("should return true for built-in CLI providers", () => {
    expect(isCliProvider("claude-cli")).toBe(true);
    expect(isCliProvider("codex-cli")).toBe(true);
    expect(isCliProvider("Claude-CLI")).toBe(true);
  });

  it("should return false for non-CLI providers", () => {
    expect(isCliProvider("anthropic")).toBe(false);
    expect(isCliProvider("openai")).toBe(false);
    expect(isCliProvider("random-provider")).toBe(false);
  });

  it("should recognize custom CLI backends from config", () => {
    const config = {
      agents: {
        defaults: {
          cliBackends: {
            "custom-cli": {
              command: "custom-llm",
              output: "json" as const,
            },
          },
        },
      },
    };

    expect(isCliProvider("custom-cli", config)).toBe(true);
    expect(isCliProvider("Custom-CLI", config)).toBe(true);
    expect(isCliProvider("unknown-cli", config)).toBe(false);
  });
});

describe("resolveCliBackendConfig", () => {
  it("should return default config for built-in providers", () => {
    const config = resolveCliBackendConfig("claude-cli");
    expect(config.command).toBe("claude");
    expect(config.output).toBe("json");
    expect(config.sessionMode).toBe("always");
  });

  it("should merge user config over defaults", () => {
    const userConfig = {
      agents: {
        defaults: {
          cliBackends: {
            "claude-cli": {
              command: "claude",
              timeoutMs: 60000,
              args: ["-p", "--output-format", "json"],
            },
          },
        },
      },
    };

    const config = resolveCliBackendConfig("claude-cli", userConfig);
    expect(config.command).toBe("claude");
    // User args should override
    expect(config.args).toEqual(["-p", "--output-format", "json"]);
    // Defaults should still be present for unset fields
    expect(config.sessionMode).toBe("always");
  });

  it("should throw for unknown providers", () => {
    expect(() => resolveCliBackendConfig("unknown-provider")).toThrow(
      /Unknown CLI provider/
    );
  });
});

describe("resolveCliModel", () => {
  it("should resolve known aliases", () => {
    expect(resolveCliModel("opus", DEFAULT_CLAUDE_BACKEND)).toBe("opus");
    expect(resolveCliModel("opus-4.5", DEFAULT_CLAUDE_BACKEND)).toBe("opus");
    expect(resolveCliModel("claude-opus-4-5", DEFAULT_CLAUDE_BACKEND)).toBe("opus");
    expect(resolveCliModel("sonnet", DEFAULT_CLAUDE_BACKEND)).toBe("sonnet");
  });

  it("should return original model if no alias found", () => {
    expect(resolveCliModel("custom-model", DEFAULT_CLAUDE_BACKEND)).toBe("custom-model");
  });
});

describe("runCliAgent", () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockProcess(stdout: string, stderr = "", exitCode = 0) {
    const mockStdout = new Readable({
      read() {
        this.push(stdout);
        this.push(null);
      },
    });

    const mockStderr = new Readable({
      read() {
        this.push(stderr);
        this.push(null);
      },
    });

    const mockStdin = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = mockStdout;
    mockProcess.stderr = mockStderr;
    mockProcess.stdin = mockStdin;
    mockProcess.killed = false;
    mockProcess.kill = vi.fn(() => {
      mockProcess.killed = true;
    });

    // Emit close event after a tick
    setTimeout(() => {
      mockProcess.emit("close", exitCode);
    }, 10);

    return mockProcess;
  }

  it("should build correct arguments for new session", async () => {
    const mockProcess = createMockProcess(
      JSON.stringify({
        result: "Hello!",
        session_id: "test-session-123",
      })
    );
    mockSpawn.mockReturnValue(mockProcess);

    const result = await runCliAgent({
      provider: "claude-cli",
      model: "opus",
      prompt: "Hello, world!",
      systemPrompt: "You are a helpful assistant.",
      isFirstMessage: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
        "--session-id",
        expect.any(String),
        "--model",
        "opus",
        "--append-system-prompt",
        "You are a helpful assistant.",
        "Hello, world!",
      ]),
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
      })
    );

    expect(result.text).toBe("Hello!");
    expect(result.sessionId).toBe("test-session-123");
  });

  it("should use resume args when resuming a session", async () => {
    const mockProcess = createMockProcess(
      JSON.stringify({
        result: "I remember you!",
        session_id: "existing-session-456",
      })
    );
    mockSpawn.mockReturnValue(mockProcess);

    await runCliAgent({
      provider: "claude-cli",
      model: "opus",
      prompt: "Remember me?",
      sessionId: "existing-session-456",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--resume");
    expect(spawnArgs).toContain("existing-session-456");
  });

  it("should parse JSON output correctly", async () => {
    const mockProcess = createMockProcess(
      JSON.stringify({
        result: { text: "Nested text response" },
        session_id: "session-789",
        usage: { tokens: 100 },
      })
    );
    mockSpawn.mockReturnValue(mockProcess);

    const result = await runCliAgent({
      provider: "claude-cli",
      model: "sonnet",
      prompt: "Test",
    });

    expect(result.text).toBe("Nested text response");
    expect(result.sessionId).toBe("session-789");
    expect(result.meta).toHaveProperty("usage");
  });

  it("should handle CLI errors gracefully", async () => {
    const mockProcess = createMockProcess("", "Command not found", 127);
    mockSpawn.mockReturnValue(mockProcess);

    const result = await runCliAgent({
      provider: "claude-cli",
      model: "opus",
      prompt: "Test",
    });

    expect(result.text).toContain("Error: CLI exited with code 127");
  });

  it("should clear sensitive environment variables", async () => {
    const mockProcess = createMockProcess(JSON.stringify({ result: "ok" }));
    mockSpawn.mockReturnValue(mockProcess);

    await runCliAgent({
      provider: "claude-cli",
      model: "opus",
      prompt: "Test",
    });

    const spawnOptions = mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(spawnOptions.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(spawnOptions.env.ANTHROPIC_API_KEY_OLD).toBeUndefined();
  });

  it("should not inject system prompt on subsequent messages when systemPromptWhen is 'first'", async () => {
    const mockProcess = createMockProcess(JSON.stringify({ result: "ok" }));
    mockSpawn.mockReturnValue(mockProcess);

    await runCliAgent({
      provider: "claude-cli",
      model: "opus",
      prompt: "Follow-up message",
      systemPrompt: "System prompt",
      isFirstMessage: false,
      sessionId: "existing-session",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain("--append-system-prompt");
  });
});

describe("JSONL output parsing", () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReset();
  });

  function createMockProcess(stdout: string, stderr = "", exitCode = 0) {
    const mockStdout = new Readable({
      read() {
        this.push(stdout);
        this.push(null);
      },
    });

    const mockStderr = new Readable({
      read() {
        this.push(stderr);
        this.push(null);
      },
    });

    const mockStdin = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = mockStdout;
    mockProcess.stderr = mockStderr;
    mockProcess.stdin = mockStdin;
    mockProcess.killed = false;
    mockProcess.kill = vi.fn();

    setTimeout(() => {
      mockProcess.emit("close", exitCode);
    }, 10);

    return mockProcess;
  }

  it("should aggregate text from JSONL output", async () => {
    const jsonlOutput = [
      '{"delta":{"text":"Hello"}}',
      '{"delta":{"text":" world"}}',
      '{"delta":{"text":"!"}, "session_id":"jsonl-session"}',
    ].join("\n");

    const mockProcess = createMockProcess(jsonlOutput);
    mockSpawn.mockReturnValue(mockProcess);

    // Use codex-cli which has jsonl output
    const result = await runCliAgent({
      provider: "codex-cli",
      model: "gpt-4o",
      prompt: "Test",
    });

    expect(result.text).toBe("Hello world!");
    expect(result.sessionId).toBe("jsonl-session");
  });
});

describe("isCliCommandAvailable", () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReset();
  });

  function createMockWhichProcess(exitCode: number) {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new Readable({ read() { this.push(null); } });
    mockProcess.stderr = new Readable({ read() { this.push(null); } });
    mockProcess.stdin = new Writable({ write(c, e, cb) { cb(); } });
    mockProcess.killed = false;
    mockProcess.kill = vi.fn();

    setTimeout(() => mockProcess.emit("close", exitCode), 10);
    return mockProcess;
  }

  it("should return true when command exists", async () => {
    mockSpawn.mockReturnValue(createMockWhichProcess(0));
    expect(await isCliCommandAvailable("claude")).toBe(true);
  });

  it("should return false when command does not exist", async () => {
    mockSpawn.mockReturnValue(createMockWhichProcess(1));
    expect(await isCliCommandAvailable("nonexistent-cmd")).toBe(false);
  });
});
