import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeToolCall, executeToolCalls } from "../executor.js";
import { ToolRegistry } from "../registry.js";
import type { ToolDefinition, ToolContext } from "../interface.js";
import * as writeGate from "../../../security/write-gate.js";

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../security/write-gate.js", () => ({
  createWriteGate: vi.fn(),
}));

// Create mock instances for policy/audit dependencies
// Note: Wallet signing (signer) is delegated to Clawlet
function createMockDeps() {
  return {
    policyEngine: {
      decide: vi.fn(async () => ({
        action: "allow" as const,
        tier: "none" as const,
        effectiveTier: "none" as const,
      })),
      resolve: vi.fn(async () => ({
        tier: "none" as const,
        requireConfirmation: false,
        confirmationChannel: "inline" as const,
        allowedUsers: undefined,
        timeout: 120,
      })),
      getThresholds: vi.fn(async () => ({
        tier3MaxUsd: 5,
        tier2MaxUsd: 50,
        tier2DailyUsd: 200,
      })),
    } as any,
    auditLogger: {
      preLog: vi.fn(async () => ({ ok: true, id: "audit-test-1" })),
      finalize: vi.fn(async () => {}),
      queryRecent: vi.fn(async () => []),
      isDegraded: vi.fn(() => false),
    } as any,
    auditQueryService: {
      query: vi.fn(async () => []),
      getStats: vi.fn(async () => ({})),
      getById: vi.fn(async () => null),
    } as any,
    cooldownTracker: {
      check: vi.fn(() => ({ allowed: true })),
      record: vi.fn(),
    } as any,
  };
}

describe("executor", () => {
  let registry: ToolRegistry;
  let mockContext: Omit<ToolContext, "requestConfirmation">;
  let mockDeps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ToolRegistry();
    mockDeps = createMockDeps();
    mockContext = {
      sessionKey: "test:session",
      agentId: "agent-1",
      config: {},
    };
  });

  describe("executeToolCall", () => {
    it("should execute a read-level tool successfully", async () => {
      const mockTool: ToolDefinition = {
        name: "echo",
        description: "Echo tool",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => ({ success: true, data: { message: "hello" } })),
      };

      registry.register(mockTool);

      const result = await executeToolCall(
        { id: "call_1", name: "echo", arguments: { message: "hello" } },
        { registry, context: mockContext, ...mockDeps }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: "hello" });
      expect(mockTool.execute).toHaveBeenCalled();
    });

    it("should return error for unknown tool", async () => {
      const result = await executeToolCall(
        { id: "call_1", name: "unknown", arguments: {} },
        { registry, context: mockContext, ...mockDeps }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should execute write-level tool with WriteGate approval", async () => {
      const mockTool: ToolDefinition = {
        name: "edit_file",
        description: "Edit file",
        parameters: { type: "object", properties: {} },
        security: { level: "write" },
        execute: vi.fn(async () => ({ success: true })),
      };

      registry.register(mockTool);

      const mockGate = {
        check: vi.fn(async () => ({ allowed: true })),
      };
      vi.mocked(writeGate.createWriteGate).mockReturnValue(mockGate as any);

      const writeGateChannel = { sendConfirmation: vi.fn() } as any;

      const result = await executeToolCall(
        { id: "call_1", name: "edit_file", arguments: { path: "test.txt" } },
        {
          registry,
          context: mockContext,
          writeGateChannel,
          workspacePath: "/workspace",
          userId: "user123",
          ...mockDeps,
        }
      );

      expect(result.success).toBe(true);
      expect(mockGate.check).toHaveBeenCalled();
      expect(mockTool.execute).toHaveBeenCalled();
    });

    it("should deny write-level tool when WriteGate denies", async () => {
      const mockTool: ToolDefinition = {
        name: "edit_file",
        description: "Edit file",
        parameters: { type: "object", properties: {} },
        security: { level: "write" },
        execute: vi.fn(async () => ({ success: true })),
      };

      registry.register(mockTool);

      const mockGate = {
        check: vi.fn(async () => ({ allowed: false, reason: "Not in allowlist" })),
      };
      vi.mocked(writeGate.createWriteGate).mockReturnValue(mockGate as any);

      const writeGateChannel = { sendConfirmation: vi.fn() } as any;

      const result = await executeToolCall(
        { id: "call_1", name: "edit_file", arguments: { path: "test.txt" } },
        {
          registry,
          context: mockContext,
          writeGateChannel,
          workspacePath: "/workspace",
          userId: "user123",
          ...mockDeps,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Write operation denied");
      expect(mockTool.execute).not.toHaveBeenCalled();
    });

    it("should deny write-level tool when WriteGate not configured", async () => {
      const mockTool: ToolDefinition = {
        name: "edit_file",
        description: "Edit file",
        parameters: { type: "object", properties: {} },
        security: { level: "write" },
        execute: vi.fn(async () => ({ success: true })),
      };

      registry.register(mockTool);

      const result = await executeToolCall(
        { id: "call_1", name: "edit_file", arguments: { path: "test.txt" } },
        { registry, context: mockContext, ...mockDeps }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("permission gate is not configured");
      expect(mockTool.execute).not.toHaveBeenCalled();
    });

    it("should handle tool execution errors", async () => {
      const mockTool: ToolDefinition = {
        name: "failing_tool",
        description: "Failing tool",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => {
          throw new Error("Tool execution failed");
        }),
      };

      registry.register(mockTool);

      const result = await executeToolCall(
        { id: "call_1", name: "failing_tool", arguments: {} },
        { registry, context: mockContext, ...mockDeps }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool execution failed");
    });
  });

  describe("executeToolCalls", () => {
    it("should execute multiple tool calls", async () => {
      const mockTool1: ToolDefinition = {
        name: "tool1",
        description: "Tool 1",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => ({ success: true, data: { result: 1 } })),
      };

      const mockTool2: ToolDefinition = {
        name: "tool2",
        description: "Tool 2",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => ({ success: true, data: { result: 2 } })),
      };

      registry.register(mockTool1);
      registry.register(mockTool2);

      const calls = [
        { id: "call_1", name: "tool1", arguments: {} },
        { id: "call_2", name: "tool2", arguments: {} },
      ];

      const results = await executeToolCalls(calls, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(results.size).toBe(2);
      expect(results.get("call_1")?.success).toBe(true);
      expect(results.get("call_2")?.success).toBe(true);
    });

    it("should execute tool calls sequentially", async () => {
      const executionOrder: number[] = [];

      const mockTool1: ToolDefinition = {
        name: "tool1",
        description: "Tool 1",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => {
          executionOrder.push(1);
          return { success: true };
        }),
      };

      const mockTool2: ToolDefinition = {
        name: "tool2",
        description: "Tool 2",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(async () => {
          executionOrder.push(2);
          return { success: true };
        }),
      };

      registry.register(mockTool1);
      registry.register(mockTool2);

      const calls = [
        { id: "call_1", name: "tool1", arguments: {} },
        { id: "call_2", name: "tool2", arguments: {} },
      ];

      await executeToolCalls(calls, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(executionOrder).toEqual([1, 2]);
    });
  });
});
