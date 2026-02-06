/**
 * Tool Loop Integration Test
 * 
 * Verifies the complete flow:
 * 1. User sends @bot message in guild
 * 2. LLM decides to call a tool (help, list_files)
 * 3. Executor runs the tool with tier/audit checks
 * 4. Tool result is returned to LLM
 * 5. LLM generates final response
 * 
 * @see Phase 1.5 task: "校验 tool loop 在 guild 的一条典型交互"
 *
 * Note: Wallet signing (signer) is delegated to Clawlet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "../registry.js";
import { executeToolCall, executeToolCalls } from "../executor.js";
import { echoTool, createHelpTool, createListFilesTool } from "../builtin/index.js";
import type { ToolContext, ToolCall, ToolResult } from "../interface.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock logger to reduce noise
vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock write-gate (not testing gate itself here)
vi.mock("../../../security/write-gate.js", () => ({
  createWriteGate: vi.fn(() => ({
    check: vi.fn(async () => ({ allowed: true })),
  })),
}));

// Minimal mock interfaces for executor dependencies
interface MockPolicyEngine {
  decide: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
  getThresholds: ReturnType<typeof vi.fn>;
}

interface MockAuditLogger {
  preLog: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
  isDegraded: ReturnType<typeof vi.fn>;
}

interface MockCooldownTracker {
  check: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

interface MockDeps {
  policyEngine: MockPolicyEngine;
  auditLogger: MockAuditLogger;
  cooldownTracker: MockCooldownTracker;
}

// Create minimal policy/audit mocks that allow execution
function createMockDeps(): MockDeps {
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
      })),
      getThresholds: vi.fn(async () => ({
        tier3MaxUsd: 10,
        tier2MaxUsd: 100,
        tier2DailyUsd: 1000,
      })),
    },
    auditLogger: {
      preLog: vi.fn(async () => ({ ok: true, id: `audit-${Date.now()}` })),
      finalize: vi.fn(async () => {}),
      isDegraded: vi.fn(() => false),
    },
    cooldownTracker: {
      check: vi.fn(() => ({ allowed: true })),
      record: vi.fn(),
    },
  };
}

describe("Tool Loop Integration", () => {
  let registry: ToolRegistry;
  let mockContext: Omit<ToolContext, "requestConfirmation">;
  let mockDeps: ReturnType<typeof createMockDeps>;
  let testWorkspace: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup test workspace in OS temp directory (avoids polluting project dir)
    testWorkspace = await mkdtemp(join(tmpdir(), "tool-loop-test-"));
    await mkdir(join(testWorkspace, "memory"), { recursive: true });
    await writeFile(join(testWorkspace, "README.md"), "# Test Workspace");
    await writeFile(join(testWorkspace, "memory", "notes.md"), "# Notes");

    // Setup registry with builtin tools
    registry = new ToolRegistry();
    registry.register(echoTool);
    registry.register(createHelpTool(registry));
    registry.register(createListFilesTool({ workspace: testWorkspace }));

    mockContext = {
      sessionKey: "discord:channel:1467915124764573736",
      agentId: "owliabot",
      config: {},
    };

    mockDeps = createMockDeps();
  });

  afterEach(async () => {
    // Cleanup test workspace
    try {
      await rm(testWorkspace, { recursive: true, force: true });
    } catch {}
  });

  describe("help tool flow", () => {
    it("should list all registered tools when @bot help is triggered", async () => {
      // Simulate LLM deciding to call help tool
      const toolCall: ToolCall = {
        id: "call_help_001",
        name: "help",
        arguments: {},
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.tools).toBeInstanceOf(Array);
      
      // Should include our registered tools
      const toolNames = result.data.tools.map((t: any) => t.name);
      expect(toolNames).toContain("echo");
      expect(toolNames).toContain("help");
      expect(toolNames).toContain("list_files");

      // Each tool should have name, description, level
      for (const tool of result.data.tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("level");
      }
    });

    it("should trigger audit logging for help tool", async () => {
      const toolCall: ToolCall = {
        id: "call_help_002",
        name: "help",
        arguments: {},
      };

      await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      // Verify audit was called
      expect(mockDeps.auditLogger.preLog).toHaveBeenCalled();
      expect(mockDeps.auditLogger.finalize).toHaveBeenCalled();
      const finalizeCall = mockDeps.auditLogger.finalize.mock.calls[0];
      expect(finalizeCall[0]).toEqual(expect.any(String)); // audit ID
      expect(finalizeCall[1]).toBe("success"); // status
    });
  });

  describe("list_files tool flow", () => {
    it("should list workspace root when @bot list files is triggered", async () => {
      const toolCall: ToolCall = {
        id: "call_list_001",
        name: "list_files",
        arguments: {},
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        workspacePath: testWorkspace,
        ...mockDeps,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.path).toBe(".");
      expect(result.data.entries).toBeInstanceOf(Array);

      // Should contain our test files
      const names = result.data.entries.map((e: any) => e.name);
      expect(names).toContain("README.md");
      expect(names).toContain("memory");
    });

    it("should list subdirectory contents", async () => {
      const toolCall: ToolCall = {
        id: "call_list_002",
        name: "list_files",
        arguments: { path: "memory" },
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        workspacePath: testWorkspace,
        ...mockDeps,
      });

      expect(result.success).toBe(true);
      expect(result.data.path).toBe("memory");
      
      const names = result.data.entries.map((e: any) => e.name);
      expect(names).toContain("notes.md");
    });

    it("should reject path traversal attempts", async () => {
      const toolCall: ToolCall = {
        id: "call_list_003",
        name: "list_files",
        arguments: { path: "../../../etc" },
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        workspacePath: testWorkspace,
        ...mockDeps,
      });

      expect(result.success).toBe(false);
      // Use regex to avoid flaky tests from wording changes
      expect(result.error).toMatch(/invalid|traversal|outside|forbidden/i);
    });

    it("should return error for non-existent directory", async () => {
      const toolCall: ToolCall = {
        id: "call_list_004",
        name: "list_files",
        arguments: { path: "nonexistent" },
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        workspacePath: testWorkspace,
        ...mockDeps,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found|does not exist|no such/i);
    });
  });

  describe("multi-tool call flow", () => {
    it("should execute multiple tool calls in sequence", async () => {
      const toolCalls: ToolCall[] = [
        { id: "call_multi_001", name: "help", arguments: {} },
        { id: "call_multi_002", name: "list_files", arguments: {} },
        { id: "call_multi_003", name: "echo", arguments: { message: "test" } },
      ];

      const resultsMap = await executeToolCalls(toolCalls, {
        registry,
        context: mockContext,
        workspacePath: testWorkspace,
        ...mockDeps,
      });

      expect(resultsMap.size).toBe(3);
      expect(resultsMap.get("call_multi_001")?.success).toBe(true); // help
      expect(resultsMap.get("call_multi_002")?.success).toBe(true); // list_files
      expect(resultsMap.get("call_multi_003")?.success).toBe(true); // echo

      // Each call should be audited
      expect(mockDeps.auditLogger.preLog).toHaveBeenCalledTimes(3);
      expect(mockDeps.auditLogger.finalize).toHaveBeenCalledTimes(3);
    });
  });

  describe("policy engine integration", () => {
    it("should check policy before executing tool", async () => {
      const toolCall: ToolCall = {
        id: "call_policy_001",
        name: "help",
        arguments: {},
      };

      await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      // Policy decision should be made
      expect(mockDeps.policyEngine.decide).toHaveBeenCalled();
    });

    it("should deny execution when policy denies", async () => {
      // Override policy to deny
      mockDeps.policyEngine.decide = vi.fn(async () => ({
        action: "deny" as const,
        tier: "none" as const,
        effectiveTier: "none" as const,
        reason: "policy-denied",
      }));

      const toolCall: ToolCall = {
        id: "call_policy_002",
        name: "help",
        arguments: {},
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/denied|forbidden|not allowed/i);
    });

    it("should check cooldown before executing", async () => {
      const toolCall: ToolCall = {
        id: "call_cooldown_001",
        name: "help",
        arguments: {},
      };

      await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(mockDeps.cooldownTracker.check).toHaveBeenCalled();
      expect(mockDeps.cooldownTracker.check.mock.calls[0][0]).toBe("help");
      expect(mockDeps.cooldownTracker.record).toHaveBeenCalled();
      expect(mockDeps.cooldownTracker.record.mock.calls[0][0]).toBe("help");
    });

    it("should reject when cooldown active", async () => {
      mockDeps.cooldownTracker.check = vi.fn(() => ({
        allowed: false,
        resetAtMs: Date.now() + 60000,
        reason: "Tool on cooldown",
      }));

      const toolCall: ToolCall = {
        id: "call_cooldown_002",
        name: "help",
        arguments: {},
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain("cooldown");
    });
  });

  describe("unknown tool handling", () => {
    it("should return error for unregistered tool", async () => {
      const toolCall: ToolCall = {
        id: "call_unknown_001",
        name: "nonexistent_tool",
        arguments: {},
      };

      const result = await executeToolCall(toolCall, {
        registry,
        context: mockContext,
        ...mockDeps,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unknown|not found|unregistered/i);
    });
  });

  describe("session context propagation", () => {
    it("should pass session key to tool context", async () => {
      let capturedContext: any = null;

      const spyTool = {
        name: "spy_tool",
        description: "Captures context for testing",
        parameters: { type: "object", properties: {} },
        security: { level: "read" as const },
        execute: vi.fn(async (_params: any, ctx: any) => {
          capturedContext = ctx;
          return { success: true, data: {} };
        }),
      };

      registry.register(spyTool);

      await executeToolCall(
        { id: "call_spy_001", name: "spy_tool", arguments: {} },
        {
          registry,
          context: {
            sessionKey: "discord:channel:test123",
            agentId: "test-agent",
            config: { custom: "value" },
          },
          ...mockDeps,
        }
      );

      expect(capturedContext).toBeDefined();
      expect(capturedContext.sessionKey).toBe("discord:channel:test123");
      expect(capturedContext.agentId).toBe("test-agent");
    });
  });
});

describe("Tool Loop E2E Simulation", () => {
  /**
   * This test simulates the full flow that would happen when
   * a user sends "@bot help" in a Discord guild channel.
   */
  it("should complete full @bot help flow", async () => {
    // 1. Setup
    const registry = new ToolRegistry();
    registry.register(echoTool);
    registry.register(createHelpTool(registry));
    
    const mockDeps = createMockDeps();
    const context = {
      sessionKey: "discord:channel:1467915124764573736", // #🦉｜oliwabot-core
      agentId: "owliabot",
      config: {},
    };

    // 2. Simulate LLM deciding to call help tool
    // (In real flow, this comes from LLM response parsing)
    const llmToolCall: ToolCall = {
      id: "toolu_01ABC",
      name: "help",
      arguments: {},
    };

    // 3. Execute tool
    const result = await executeToolCall(llmToolCall, {
      registry,
      context,
      ...mockDeps,
    });

    // 4. Verify tool executed successfully
    expect(result.success).toBe(true);
    expect(result.data.tools).toBeDefined();

    // 5. Verify audit trail
    expect(mockDeps.auditLogger.preLog).toHaveBeenCalled();
    expect(mockDeps.auditLogger.finalize).toHaveBeenCalled();
    const finalizeCall = mockDeps.auditLogger.finalize.mock.calls[0];
    expect(finalizeCall[0]).toEqual(expect.any(String)); // audit ID
    expect(finalizeCall[1]).toBe("success"); // status

    // 6. In real flow, this result would be sent back to LLM
    // for final response generation
    const toolResultForLLM = {
      type: "tool_result" as const,
      tool_use_id: llmToolCall.id,
      content: JSON.stringify(result.data),
    };

    expect(toolResultForLLM.content).toContain("echo");
    expect(toolResultForLLM.content).toContain("help");
  });
});
