/**
 * Tool Router Tests
 * @see docs/design/skill-system.md Section 3.1
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { ToolRouter, type ToolRegistry, type AuditLogger, type ToolRouterContext, type AuditEntry } from "../tool-router.js";
import type { WriteGate, WriteGateResult, WriteGateCallContext } from "../../security/write-gate.js";
import type { ToolCall, ToolDefinition, ToolResult } from "../../agent/tools/interface.js";

// ── Test Fixtures ──────────────────────────────────────────────────────────

function createMockTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "test-tool",
    description: "A test tool",
    parameters: { type: "object", properties: {} },
    security: { level: "read" },
    execute: vi.fn().mockResolvedValue({ success: true, data: "executed" }),
    ...overrides,
  };
}

function createMockWriteGate(): WriteGate & { check: Mock } {
  return {
    check: vi.fn().mockResolvedValue({ allowed: true, reason: "approved" } as WriteGateResult),
  } as unknown as WriteGate & { check: Mock };
}

function createMockToolRegistry(tools: ToolDefinition[] = []): ToolRegistry {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  return {
    get: (name: string) => toolMap.get(name),
    list: () => tools,
  };
}

function createMockAuditLogger(): AuditLogger & { log: Mock } {
  return {
    log: vi.fn().mockResolvedValue(undefined),
  };
}

function createContext(overrides: Partial<ToolRouterContext> = {}): ToolRouterContext {
  return {
    userId: "user-123",
    sessionId: "session-456",
    channel: "discord",
    target: "channel-789",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ToolRouter", () => {
  let writeGate: WriteGate & { check: Mock };
  let auditLogger: AuditLogger & { log: Mock };
  let context: ToolRouterContext;

  beforeEach(() => {
    writeGate = createMockWriteGate();
    auditLogger = createMockAuditLogger();
    context = createContext();
    vi.clearAllMocks();
  });

  describe("Read tools", () => {
    it("should execute read tools directly without WriteGate check", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      const result = await router.callTool("read-file", { path: "/test.md" }, context);

      expect(result.success).toBe(true);
      expect(result.data).toBe("executed");
      expect(writeGate.check).not.toHaveBeenCalled();
      expect(readTool.execute).toHaveBeenCalledTimes(1);
    });

    it("should pass correct context to tool execute", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      await router.callTool("read-file", { path: "/test.md" }, context);

      expect(readTool.execute).toHaveBeenCalledWith(
        { path: "/test.md" },
        expect.objectContaining({
          sessionKey: "session-456",
          agentId: "skill-router",
        }),
      );
    });
  });

  describe("Write tools", () => {
    it("should call WriteGate.check() for write tools", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("edit-file", { path: "/test.md", content: "hello" }, context);

      expect(writeGate.check).toHaveBeenCalledTimes(1);
      expect(writeGate.check).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "edit-file",
          arguments: { path: "/test.md", content: "hello" },
        }),
        expect.objectContaining({
          userId: "user-123",
          sessionKey: "session-456",
          target: "channel-789",
        }),
      );
    });

    it("should execute write tool when WriteGate allows", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      writeGate.check.mockResolvedValue({ allowed: true, reason: "approved" });
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      const result = await router.callTool("edit-file", { path: "/test.md" }, context);

      expect(result.success).toBe(true);
      expect(writeTool.execute).toHaveBeenCalledTimes(1);
    });

    it("should deny write tool when WriteGate denies", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      writeGate.check.mockResolvedValue({ allowed: false, reason: "not_in_allowlist" });
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      const result = await router.callTool("edit-file", { path: "/test.md" }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Access denied");
      expect(result.error).toContain("not_in_allowlist");
      expect(writeTool.execute).not.toHaveBeenCalled();
    });

    it("should deny write tool on timeout", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      writeGate.check.mockResolvedValue({ allowed: false, reason: "timeout" });
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      const result = await router.callTool("edit-file", { path: "/test.md" }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
      expect(writeTool.execute).not.toHaveBeenCalled();
    });

    it("should deny write tool when user rejects confirmation", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      writeGate.check.mockResolvedValue({ allowed: false, reason: "denied" });
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      const result = await router.callTool("edit-file", { path: "/test.md" }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied");
      expect(writeTool.execute).not.toHaveBeenCalled();
    });
  });

  describe("Sign tools", () => {
    it("should execute sign-level tools (TierPolicy evaluated on callSigner)", async () => {
      const signTool = createMockTool({
        name: "transfer",
        security: { level: "sign" },
      });
      const registry = createMockToolRegistry([signTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      const result = await router.callTool("transfer", { to: "0x123", amount: "1" }, context);

      // Sign-level tools execute normally; TierPolicy is evaluated when
      // the skill code calls callSigner(), not at tool invocation time
      expect(result.success).toBe(true);
      expect(signTool.execute).toHaveBeenCalled();
    });
  });

  describe("Tool not found", () => {
    it("should return error when tool not found", async () => {
      const registry = createMockToolRegistry([]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      const result = await router.callTool("unknown-tool", {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool not found");
      expect(result.error).toContain("unknown-tool");
    });
  });

  describe("Tool execution errors", () => {
    it("should catch and return tool execution errors", async () => {
      const errorTool = createMockTool({
        name: "error-tool",
        security: { level: "read" },
      });
      (errorTool.execute as Mock).mockRejectedValue(new Error("Boom!"));
      const registry = createMockToolRegistry([errorTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      const result = await router.callTool("error-tool", {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Execution failed");
      expect(result.error).toContain("Boom!");
    });

    it("should handle non-Error throws", async () => {
      const errorTool = createMockTool({
        name: "error-tool",
        security: { level: "read" },
      });
      (errorTool.execute as Mock).mockRejectedValue("string error");
      const registry = createMockToolRegistry([errorTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      const result = await router.callTool("error-tool", {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("string error");
    });
  });

  describe("Audit logging", () => {
    it("should log successful read tool calls", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("read-file", { path: "/test.md" }, context);

      expect(auditLogger.log).toHaveBeenCalledTimes(1);
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "read-file",
          securityLevel: "read",
          userId: "user-123",
          sessionId: "session-456",
          channel: "discord",
          result: "success",
          params: { path: "/test.md" },
        }),
      );
    });

    it("should log denied write tool calls with gate info", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      writeGate.check.mockResolvedValue({ allowed: false, reason: "not_in_allowlist" });
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("edit-file", { path: "/test.md" }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "edit-file",
          securityLevel: "write",
          result: "denied",
          gate: "WriteGate",
          gateDecision: "not_in_allowlist",
        }),
      );
    });

    it("should log approved write tool calls", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      writeGate.check.mockResolvedValue({ allowed: true, reason: "approved" });
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("edit-file", { path: "/test.md" }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "edit-file",
          result: "success",
          gate: "WriteGate",
          gateDecision: "approved",
        }),
      );
    });

    it("should log tool not found errors", async () => {
      const registry = createMockToolRegistry([]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("missing-tool", {}, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "missing-tool",
          result: "tool_not_found",
          error: expect.stringContaining("Tool not found"),
        }),
      );
    });

    it("should log execution errors", async () => {
      const errorTool = createMockTool({
        name: "error-tool",
        security: { level: "read" },
      });
      (errorTool.execute as Mock).mockRejectedValue(new Error("Kaboom"));
      const registry = createMockToolRegistry([errorTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("error-tool", {}, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: "error-tool",
          result: "error",
          error: "Kaboom",
        }),
      );
    });

    it("should sanitize params in audit logs (truncate long text)", async () => {
      const writeTool = createMockTool({
        name: "edit-file",
        security: { level: "write" },
      });
      const registry = createMockToolRegistry([writeTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      const longContent = "x".repeat(200);
      await router.callTool("edit-file", { path: "/test.md", content: longContent }, context);

      const logCall = auditLogger.log.mock.calls[0][0] as AuditEntry;
      expect(logCall.params.path).toBe("/test.md");
      expect(logCall.params.content).toBe("x".repeat(100) + "…");
    });

    it("should not fail if audit logger throws", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      auditLogger.log.mockRejectedValue(new Error("Audit failed"));
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      // Should not throw
      const result = await router.callTool("read-file", { path: "/test.md" }, context);

      expect(result.success).toBe(true);
    });

    it("should work without audit logger", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      // Should not throw
      const result = await router.callTool("read-file", { path: "/test.md" }, context);

      expect(result.success).toBe(true);
    });

    it("should include duration in audit logs", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry, auditLogger });

      await router.callTool("read-file", {}, context);

      const logCall = auditLogger.log.mock.calls[0][0] as AuditEntry;
      expect(typeof logCall.durationMs).toBe("number");
      expect(logCall.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("requestConfirmation passthrough", () => {
    it("should pass requestConfirmation to tool context when provided", async () => {
      const readTool = createMockTool({
        name: "read-file",
        security: { level: "read" },
      });
      const registry = createMockToolRegistry([readTool]);
      const router = new ToolRouter({ writeGate, toolRegistry: registry });

      const confirmFn = vi.fn().mockResolvedValue(true);
      const contextWithConfirm = createContext({ requestConfirmation: confirmFn });

      await router.callTool("read-file", {}, contextWithConfirm);

      const executeCall = (readTool.execute as Mock).mock.calls[0];
      const toolContext = executeCall[1];
      expect(toolContext.requestConfirmation).toBeDefined();

      // Test that the wrapper works
      const result = await toolContext.requestConfirmation({ description: "test?" });
      expect(confirmFn).toHaveBeenCalledWith("test?");
      expect(result).toBe(true);
    });
  });
});

describe("createToolRouter", () => {
  it("should create a ToolRouter instance", async () => {
    // Import here to avoid circular dependency issues in tests
    const { createToolRouter } = await import("../tool-router.js");
    
    const writeGate = createMockWriteGate();
    const registry = createMockToolRegistry([]);
    
    const router = createToolRouter({ writeGate, toolRegistry: registry });
    
    expect(router).toBeInstanceOf(ToolRouter);
  });
});
