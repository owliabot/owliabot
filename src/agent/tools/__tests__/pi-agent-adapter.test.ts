// src/agent/tools/__tests__/pi-agent-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { adaptToolForAgent, adaptAllTools } from "../pi-agent-adapter.js";
import type { ToolDefinition } from "../interface.js";
import { ToolRegistry } from "../registry.js";

// Mock logger
vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock policy/audit system to allow all operations
function createMockPolicyEngine() {
  return {
    decide: vi.fn(async () => ({
      action: "allow" as const,
      tier: "none" as const,
      effectiveTier: "none" as const,
    })),
    resolve: vi.fn(async () => ({
      allowedUsers: undefined,
      cooldown: undefined,
    })),
    getThresholds: vi.fn(async () => ({})),
  };
}

function createMockAuditLogger() {
  return {
    preLog: vi.fn(async () => ({ ok: true, id: "test-audit-id" })),
    finalize: vi.fn(async () => {}),
  };
}

function createMockAuditQueryService() {
  return {
    query: vi.fn(async () => []),
  };
}

function createMockCooldownTracker() {
  return {
    check: vi.fn(() => ({ allowed: true })),
    record: vi.fn(),
  };
}

describe("pi-agent-adapter", () => {
  let mockPolicyEngine: ReturnType<typeof createMockPolicyEngine>;
  let mockAuditLogger: ReturnType<typeof createMockAuditLogger>;
  let mockAuditQueryService: ReturnType<typeof createMockAuditQueryService>;
  let mockCooldownTracker: ReturnType<typeof createMockCooldownTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyEngine = createMockPolicyEngine();
    mockAuditLogger = createMockAuditLogger();
    mockAuditQueryService = createMockAuditQueryService();
    mockCooldownTracker = createMockCooldownTracker();
  });

  describe("adaptToolForAgent", () => {
    it("converts a ToolDefinition to AgentTool format", () => {
      const tool: ToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
          required: ["input"],
        },
        security: { level: "read" },
        execute: vi.fn().mockResolvedValue({
          success: true,
          data: "result",
        }),
      };

      const registry = new ToolRegistry();
      registry.register(tool);

      const agentTool = adaptToolForAgent(tool, registry, {
        context: {
          sessionKey: "test",
          agentId: "test",
          config: { channel: "test", target: "test" },
        },
        workspacePath: "/tmp/test-workspace",
      });

      expect(agentTool.name).toBe("test_tool");
      expect(agentTool.label).toBe("test_tool");
      expect(agentTool.description).toBe("A test tool");
      expect(agentTool.parameters).toEqual(tool.parameters);
      expect(agentTool.execute).toBeDefined();
    });

    // TODO(pi-agent-core): Fix audit system mocking to properly test tool execution
    // Currently fails because audit logger requires filesystem setup
    it.skip("executes tool and returns AgentToolResult", async () => {
      const tool: ToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {},
        },
        security: { level: "read" }, // Mark as read-only to bypass write-gate
        execute: vi.fn().mockResolvedValue({
          success: true,
          data: "success result",
        }),
      };

      const registry = new ToolRegistry();
      registry.register(tool);

      const agentTool = adaptToolForAgent(tool, registry, {
        context: {
          sessionKey: "test",
          agentId: "test",
          config: { channel: "test", target: "test" },
        },
        securityConfig: { writeGateEnabled: false }, // Disable write-gate for testing
        workspacePath: "/tmp/test-workspace", // Provide workspace path
      });

      const result = await agentTool.execute("call-1", {});

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "success result",
      });
      expect(result.details.success).toBe(true);
      expect(result.details.toolCallId).toBe("call-1");
    });

    // TODO(pi-agent-core): Fix audit system mocking to properly test error handling
    it.skip("handles tool execution errors", async () => {
      const tool: ToolDefinition = {
        name: "failing_tool",
        description: "A failing tool",
        parameters: {
          type: "object",
          properties: {},
        },
        security: { level: "read" }, // Mark as read-only to bypass write-gate
        execute: vi.fn().mockResolvedValue({
          success: false,
          error: "Tool failed",
        }),
      };

      const registry = new ToolRegistry();
      registry.register(tool);

      const agentTool = adaptToolForAgent(tool, registry, {
        context: {
          sessionKey: "test",
          agentId: "test",
          config: { channel: "test", target: "test" },
        },
        securityConfig: { writeGateEnabled: false }, // Disable write-gate for testing
        workspacePath: "/tmp/test-workspace", // Provide workspace path
      });

      const result = await agentTool.execute("call-1", {});

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Error: Tool failed",
      });
      expect(result.details.success).toBe(false);
      expect(result.details.toolCallId).toBe("call-1");
      expect(result.details.error).toBe("Tool failed");
    });

    // TODO(pi-agent-core): Fix audit system mocking to properly test JSON serialization
    it.skip("serializes object results to JSON", async () => {
      const tool: ToolDefinition = {
        name: "object_tool",
        description: "Returns an object",
        parameters: {
          type: "object",
          properties: {},
        },
        security: { level: "read" }, // Mark as read-only to bypass write-gate
        execute: vi.fn().mockResolvedValue({
          success: true,
          data: { key: "value", nested: { field: 123 } },
        }),
      };

      const registry = new ToolRegistry();
      registry.register(tool);

      const agentTool = adaptToolForAgent(tool, registry, {
        context: {
          sessionKey: "test",
          agentId: "test",
          config: { channel: "test", target: "test" },
        },
        securityConfig: { writeGateEnabled: false }, // Disable write-gate for testing
        workspacePath: "/tmp/test-workspace", // Provide workspace path
      });

      const result = await agentTool.execute("call-1", {});

      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as any).text;
      const parsed = JSON.parse(text);
      expect(parsed).toEqual({ key: "value", nested: { field: 123 } });
    });
  });

  describe("adaptAllTools", () => {
    it("converts all tools in registry", () => {
      const tool1: ToolDefinition = {
        name: "tool_1",
        description: "Tool 1",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(),
      };

      const tool2: ToolDefinition = {
        name: "tool_2",
        description: "Tool 2",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(),
      };

      const registry = new ToolRegistry();
      registry.register(tool1);
      registry.register(tool2);

      const agentTools = adaptAllTools(registry, {
        context: {
          sessionKey: "test",
          agentId: "test",
          config: { channel: "test", target: "test" },
        },
        workspacePath: "/tmp/test-workspace",
      });

      expect(agentTools).toHaveLength(2);
      expect(agentTools[0].name).toBe("tool_1");
      expect(agentTools[1].name).toBe("tool_2");
    });

    it("returns empty array for empty registry", () => {
      const registry = new ToolRegistry();

      const agentTools = adaptAllTools(registry, {
        context: {
          sessionKey: "test",
          agentId: "test",
          config: { channel: "test", target: "test" },
        },
        workspacePath: "/tmp/test-workspace",
      });

      expect(agentTools).toHaveLength(0);
    });
  });
});
