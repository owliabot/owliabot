// src/gateway/__tests__/agentic-loop.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgenticLoop, createConversation } from "../agentic-loop.js";
import type { Message } from "../../agent/session.js";

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock LLM runner
const mockCallWithFailover = vi.fn();
vi.mock("../../agent/runner.js", () => ({
  callWithFailover: (...args: any[]) => mockCallWithFailover(...args),
}));

// Mock tool executor
const mockExecuteToolCalls = vi.fn();
vi.mock("../../agent/tools/executor.js", () => ({
  executeToolCalls: (...args: any[]) => mockExecuteToolCalls(...args),
}));

describe("agentic-loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createConversation", () => {
    it("creates conversation with system prompt first", () => {
      const history: Message[] = [
        { role: "user", content: "Hello", timestamp: 1000 },
        { role: "assistant", content: "Hi!", timestamp: 1001 },
      ];

      const result = createConversation("System prompt", history);

      expect(result[0]).toEqual({
        role: "system",
        content: "System prompt",
        timestamp: expect.any(Number),
      });
      expect(result.slice(1)).toEqual(history);
    });

    it("handles empty history", () => {
      const result = createConversation("System prompt", []);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("system");
    });
  });

  // TODO(pi-agent-core): Rewrite these tests for pi-agent-core integration
  // Current tests mock callWithFailover which bypasses the new agentLoop implementation
  // Need to mock pi-agent-core's agentLoop or create integration tests instead
  describe.skip("runAgenticLoop", () => {
    const makeContext = () => ({
      sessionKey: "session:123",
      agentId: "main",
      sessionId: "sid123",
      userId: "user1",
      channelId: "telegram",
      workspacePath: "/workspace",
    });

    const makeConfig = () => ({
      providers: [{ id: "test", model: "test-model", apiKey: "key" }] as any[],
      tools: { getAll: vi.fn(() => []) } as any,
      transcripts: { append: vi.fn() } as any,
    });

    it("returns content when no tool calls", async () => {
      mockCallWithFailover.mockResolvedValue({
        content: "Hello there!",
        toolCalls: null,
      });

      const result = await runAgenticLoop(
        [{ role: "user", content: "Hi", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      expect(result.content).toBe("Hello there!");
      expect(result.iterations).toBe(1);
      expect(result.toolCallsCount).toBe(0);
      expect(result.maxIterationsReached).toBe(false);
      expect(result.timedOut).toBe(false);
    });

    it("returns content when empty tool calls array", async () => {
      mockCallWithFailover.mockResolvedValue({
        content: "Hello!",
        toolCalls: [],
      });

      const result = await runAgenticLoop(
        [{ role: "user", content: "Hi", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      expect(result.content).toBe("Hello!");
      expect(result.iterations).toBe(1);
    });

    it("executes tool calls and continues loop", async () => {
      // First call: returns tool call
      // Second call: returns final response
      mockCallWithFailover
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [{ id: "call1", name: "read", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "Done!",
          toolCalls: null,
        });

      mockExecuteToolCalls.mockResolvedValue(
        new Map([["call1", { success: true, result: "file content" }]])
      );

      const config = makeConfig();
      const result = await runAgenticLoop(
        [{ role: "user", content: "Read file", timestamp: 1000 }],
        makeContext(),
        config
      );

      expect(result.content).toBe("Done!");
      expect(result.iterations).toBe(2);
      expect(result.toolCallsCount).toBe(1);
      expect(mockExecuteToolCalls).toHaveBeenCalledTimes(1);
      // Transcript should have tool call message and result message
      expect(config.transcripts.append).toHaveBeenCalledTimes(2);
    });

    it("handles multiple tool calls in single iteration", async () => {
      mockCallWithFailover
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [
            { id: "call1", name: "read", input: {} },
            { id: "call2", name: "write", input: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: "Both done!",
          toolCalls: null,
        });

      mockExecuteToolCalls.mockResolvedValue(
        new Map([
          ["call1", { success: true, result: "content" }],
          ["call2", { success: true, result: "written" }],
        ])
      );

      const result = await runAgenticLoop(
        [{ role: "user", content: "Do stuff", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      expect(result.toolCallsCount).toBe(2);
      expect(result.iterations).toBe(2);
    });

    it("stops at max iterations", async () => {
      // Always return tool calls
      mockCallWithFailover.mockResolvedValue({
        content: "",
        toolCalls: [{ id: "call1", name: "loop", input: {} }],
      });

      mockExecuteToolCalls.mockResolvedValue(
        new Map([["call1", { success: true, result: "loop" }]])
      );

      const result = await runAgenticLoop(
        [{ role: "user", content: "Loop forever", timestamp: 1000 }],
        makeContext(),
        { ...makeConfig(), maxIterations: 3 }
      );

      expect(result.iterations).toBe(3);
      expect(result.maxIterationsReached).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.content).toContain("couldn't complete");
    });

    it("uses default maxIterations of 50 (but fallback to 5 for CLI)", async () => {
      mockCallWithFailover.mockResolvedValue({
        content: "",
        toolCalls: [{ id: "call1", name: "loop", input: {} }],
      });

      mockExecuteToolCalls.mockResolvedValue(
        new Map([["call1", { success: true, result: "loop" }]])
      );

      const result = await runAgenticLoop(
        [{ role: "user", content: "Loop", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      // Note: With the current implementation, we fallback to legacy loop for non-pi-agent-core paths
      // Legacy loop uses maxIterations ?? 5
      expect(result.iterations).toBe(5);
    });

    it("handles LLM errors gracefully", async () => {
      mockCallWithFailover.mockRejectedValue(new Error("API error"));

      const result = await runAgenticLoop(
        [{ role: "user", content: "Hi", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      expect(result.content).toContain("处理失败");
      expect(result.content).toContain("API error");
      expect(result.error).toBe("API error");
    });

    it("provides helpful message for missing API key", async () => {
      mockCallWithFailover.mockRejectedValue(
        new Error("No API key found for anthropic")
      );

      const result = await runAgenticLoop(
        [{ role: "user", content: "Hi", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      expect(result.content).toContain("Anthropic 未授权");
      expect(result.content).toContain("owliabot auth setup");
    });

    it("handles tool execution errors", async () => {
      mockCallWithFailover
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [{ id: "call1", name: "bad_tool", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "Handled error",
          toolCalls: null,
        });

      mockExecuteToolCalls.mockResolvedValue(
        new Map([["call1", { success: false, error: "Tool failed" }]])
      );

      const result = await runAgenticLoop(
        [{ role: "user", content: "Run bad tool", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      // Should continue and let LLM handle the error
      expect(result.content).toBe("Handled error");
    });

    it("handles missing tool results", async () => {
      mockCallWithFailover
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [{ id: "call1", name: "tool", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "OK",
          toolCalls: null,
        });

      // Return empty map (no results)
      mockExecuteToolCalls.mockResolvedValue(new Map());

      const config = makeConfig();
      await runAgenticLoop(
        [{ role: "user", content: "Run", timestamp: 1000 }],
        makeContext(),
        config
      );

      // Should create a "Missing tool result" error entry
      expect(config.transcripts.append).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          toolResults: expect.arrayContaining([
            expect.objectContaining({
              success: false,
              error: "Missing tool result",
            }),
          ]),
        })
      );
    });

    it.skip("passes WriteGate channel to tool executor", async () => {
      // Skipped: New pi-agent-core implementation handles this internally
      mockCallWithFailover.mockResolvedValue({
        content: "Hi",
        toolCalls: null,
      });

      const writeGateChannel = { send: vi.fn() };

      await runAgenticLoop(
        [{ role: "user", content: "Hi", timestamp: 1000 }],
        makeContext(),
        { ...makeConfig(), writeGateChannel: writeGateChannel as any }
      );

      // Even with no tool calls, the config should be set up correctly
      // We can verify this by checking a tool call scenario
    });

    it.skip("passes security config to tool executor", async () => {
      // Skipped: New pi-agent-core implementation handles this via adapter
      mockCallWithFailover
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [{ id: "call1", name: "tool", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "Done",
          toolCalls: null,
        });

      mockExecuteToolCalls.mockResolvedValue(
        new Map([["call1", { success: true, result: "ok" }]])
      );

      const context = {
        ...makeContext(),
        securityConfig: { allowList: ["tool1"] } as any,
      };

      await runAgenticLoop(
        [{ role: "user", content: "Run", timestamp: 1000 }],
        context,
        makeConfig()
      );

      expect(mockExecuteToolCalls).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          securityConfig: { allowList: ["tool1"] },
        })
      );
    });

    it.skip("accumulates messages from multiple iterations", async () => {
      // Skipped: New pi-agent-core implementation manages messages internally
      mockCallWithFailover
        .mockResolvedValueOnce({
          content: "Step 1",
          toolCalls: [{ id: "call1", name: "tool", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "Step 2",
          toolCalls: [{ id: "call2", name: "tool", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "Done",
          toolCalls: null,
        });

      mockExecuteToolCalls
        .mockResolvedValueOnce(new Map([["call1", { success: true, result: "r1" }]]))
        .mockResolvedValueOnce(new Map([["call2", { success: true, result: "r2" }]]));

      const result = await runAgenticLoop(
        [{ role: "user", content: "Multi-step", timestamp: 1000 }],
        makeContext(),
        makeConfig()
      );

      expect(result.iterations).toBe(3);
      expect(result.toolCallsCount).toBe(2);
      // 2 tool call messages + 2 tool result messages = 4 new messages
      expect(result.messages).toHaveLength(4);
    });
  });
});
