/**
 * Skill System E2E Tests
 *
 * Tests the complete skill execution pipeline including:
 * - Skill loading and manifest parsing
 * - Read tool execution (no security gate)
 * - Write tool execution (WriteGate confirmation)
 * - Sign tool execution (TierPolicy routing)
 * - Audit logging
 *
 * All external dependencies are mocked for offline execution.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSkills, parseSkillManifest, scanSkillsDirectory } from "../skills/loader.js";
import { skillToToolDefinitions } from "../skills/registry.js";
import { ToolRouter, type ToolRegistry, type AuditLogger, type AuditEntry } from "../skills/tool-router.js";
import { SignerRouter } from "../skills/signer-router.js";
import { WriteGate, type WriteGateChannel, type WriteGateConfig } from "../security/write-gate.js";
import type { ToolDefinition, ToolResult, ToolSecurity } from "../agent/tools/interface.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { PolicyDecision, EscalationContext } from "../policy/types.js";
import type { SignerService, SignerRouterContext, SessionKeyStatus } from "../skills/signer-service-interface.js";
import type { SignerTier } from "../signer/interface.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILLS_DIR = join(__dirname, "../skills/builtin");
const TMP_WORKSPACE = "/tmp/skill-e2e-test";
const AUDIT_PATH = join(TMP_WORKSPACE, "audit.jsonl");

// ── Mock Implementations ───────────────────────────────────────────────────

/**
 * In-memory audit logger for testing
 */
class MockAuditLogger implements AuditLogger {
  entries: AuditEntry[] = [];

  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries = [];
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }
}

/**
 * Simple tool registry implementation for testing
 */
class SimpleToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  clear(): void {
    this.tools.clear();
  }
}

/**
 * Mock WriteGate channel for testing confirmation flow
 */
class MockWriteGateChannel implements WriteGateChannel {
  private pendingReplies: Map<string, string> = new Map();
  public sentMessages: Array<{ target: string; text: string }> = [];

  setReply(target: string, reply: string): void {
    this.pendingReplies.set(target, reply);
  }

  async sendMessage(target: string, msg: { text: string }): Promise<void> {
    this.sentMessages.push({ target, text: msg.text });
  }

  async waitForReply(target: string, _fromUserId: string, timeoutMs: number): Promise<string | null> {
    const reply = this.pendingReplies.get(target);
    if (reply !== undefined) {
      this.pendingReplies.delete(target);
      return reply;
    }
    // Simulate timeout
    await new Promise((resolve) => setTimeout(resolve, 10));
    return null;
  }

  clear(): void {
    this.pendingReplies.clear();
    this.sentMessages = [];
  }
}

/**
 * Mock policy engine for testing tier decisions
 */
class MockPolicyEngine implements Pick<PolicyEngine, "decide" | "getThresholds"> {
  private nextDecision: PolicyDecision | null = null;

  setNextDecision(decision: PolicyDecision): void {
    this.nextDecision = decision;
  }

  async decide(
    _toolName: string,
    _params: unknown,
    _context: EscalationContext
  ): Promise<PolicyDecision> {
    if (this.nextDecision) {
      const decision = this.nextDecision;
      this.nextDecision = null;
      return decision;
    }
    // Default: allow with session-key
    return {
      action: "allow",
      tier: 3,
      effectiveTier: 3,
      signerTier: "session-key",
    };
  }

  async getThresholds(): Promise<{ tier3MaxUsd: number; tier2MaxUsd: number; tier2DailyUsd: number }> {
    return {
      tier3MaxUsd: 50,
      tier2MaxUsd: 500,
      tier2DailyUsd: 1000,
    };
  }
}

/**
 * Mock signer service for testing sign operations
 */
class MockSignerService implements SignerService {
  public executedOperations: Array<{ operation: string; params: unknown; signerTier: SignerTier }> = [];
  private nextResult: { success: boolean; data?: unknown; error?: string } | null = null;

  setNextResult(result: { success: boolean; data?: unknown; error?: string }): void {
    this.nextResult = result;
  }

  async execute(
    operation: string,
    params: unknown,
    signerTier: SignerTier
  ): Promise<{ success: boolean; data?: { txHash?: string }; error?: string }> {
    this.executedOperations.push({ operation, params, signerTier });

    if (this.nextResult) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }

    return {
      success: true,
      data: {
        txHash: "0x" + "a".repeat(64),
      },
    };
  }

  canExecute(signerTier: SignerTier): boolean {
    return signerTier !== "none";
  }

  async getSessionKeyStatus(): Promise<SessionKeyStatus> {
    return {
      id: "mock-session-key",
      available: true,
      expired: false,
      revoked: false,
      expiresAt: Date.now() + 86400000,
    };
  }

  clear(): void {
    this.executedOperations = [];
    this.nextResult = null;
  }
}

// ── Mock Weather API Response ──────────────────────────────────────────────

const MOCK_WEATHER_RESPONSE = {
  current_condition: [
    {
      temp_C: "20",
      FeelsLikeC: "18",
      weatherDesc: [{ value: "Sunny" }],
      humidity: "45",
      windspeedKmph: "10",
    },
  ],
  nearest_area: [
    {
      areaName: [{ value: "London" }],
      country: [{ value: "United Kingdom" }],
    },
  ],
};

// ── Test Suite ─────────────────────────────────────────────────────────────

describe.sequential("E2E: Skill System", () => {
  let mockAuditLogger: MockAuditLogger;
  let mockChannel: MockWriteGateChannel;
  let mockPolicyEngine: MockPolicyEngine;
  let mockSignerService: MockSignerService;
  let toolRegistry: SimpleToolRegistry;
  let toolRouter: ToolRouter;

  beforeAll(async () => {
    // Create temp workspace
    await rm(TMP_WORKSPACE, { recursive: true, force: true });
    await mkdir(TMP_WORKSPACE, { recursive: true });
  });

  afterAll(async () => {
    await rm(TMP_WORKSPACE, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockAuditLogger = new MockAuditLogger();
    mockChannel = new MockWriteGateChannel();
    mockPolicyEngine = new MockPolicyEngine();
    mockSignerService = new MockSignerService();
    toolRegistry = new SimpleToolRegistry();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Skill Loading Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe("Skill Loading", () => {
    it("scans builtin skills directory and finds all skills", async () => {
      const skillPaths = await scanSkillsDirectory(BUILTIN_SKILLS_DIR);

      expect(skillPaths.length).toBeGreaterThanOrEqual(3);
      expect(skillPaths.some((p) => p.includes("weather"))).toBe(true);
      expect(skillPaths.some((p) => p.includes("todo"))).toBe(true);
      expect(skillPaths.some((p) => p.includes("transfer"))).toBe(true);
    });

    it("parses weather skill manifest correctly", async () => {
      const manifest = await parseSkillManifest(join(BUILTIN_SKILLS_DIR, "weather"));

      expect(manifest.name).toBe("weather");
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.main).toBe("index.js");
      expect(manifest.owliabot.tools).toHaveLength(1);

      const getTool = manifest.owliabot.tools[0];
      expect(getTool.name).toBe("get");
      expect(getTool.security.level).toBe("read");
      expect(getTool.parameters.properties.city).toBeDefined();
      expect(getTool.parameters.required).toContain("city");
    });

    it("parses todo skill manifest with multiple tools", async () => {
      const manifest = await parseSkillManifest(join(BUILTIN_SKILLS_DIR, "todo"));

      expect(manifest.name).toBe("todo");
      expect(manifest.owliabot.tools).toHaveLength(3);

      const toolNames = manifest.owliabot.tools.map((t) => t.name);
      expect(toolNames).toContain("add");
      expect(toolNames).toContain("list");
      expect(toolNames).toContain("complete");

      // Check security levels
      const addTool = manifest.owliabot.tools.find((t) => t.name === "add");
      const listTool = manifest.owliabot.tools.find((t) => t.name === "list");
      expect(addTool?.security.level).toBe("write");
      expect(listTool?.security.level).toBe("read");
    });

    it("parses transfer skill manifest with sign-level security", async () => {
      const manifest = await parseSkillManifest(join(BUILTIN_SKILLS_DIR, "transfer"));

      expect(manifest.name).toBe("transfer");

      const sendTool = manifest.owliabot.tools.find((t) => t.name === "send");
      const estimateTool = manifest.owliabot.tools.find((t) => t.name === "estimate");

      expect(sendTool?.security.level).toBe("sign");
      expect(estimateTool?.security.level).toBe("read");
      expect(sendTool?.parameters.required).toEqual(
        expect.arrayContaining(["token", "to", "amount"])
      );
    });

    it("loads all builtin skills successfully", async () => {
      const result = await loadSkills(BUILTIN_SKILLS_DIR);

      expect(result.failed).toHaveLength(0);
      expect(result.loaded.length).toBeGreaterThanOrEqual(3);

      const skillNames = result.loaded.map((s) => s.manifest.name);
      expect(skillNames).toContain("weather");
      expect(skillNames).toContain("todo");
      expect(skillNames).toContain("transfer");
    });

    it("converts loaded skills to tool definitions with namespaced names", async () => {
      const result = await loadSkills(BUILTIN_SKILLS_DIR);
      const weatherSkill = result.loaded.find((s) => s.manifest.name === "weather");

      expect(weatherSkill).toBeDefined();

      const toolDefs = skillToToolDefinitions(weatherSkill!);
      expect(toolDefs).toHaveLength(1);
      expect(toolDefs[0].name).toBe("weather__get");
      expect(toolDefs[0].security.level).toBe("read");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Read Tool Execution Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe("Read Tool Execution", () => {
    it("executes weather skill get tool without WriteGate", async () => {
      // Mock fetch for weather API
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_WEATHER_RESPONSE,
      });

      // Create a mock read tool that uses our mocked fetch
      const weatherTool: ToolDefinition = {
        name: "weather__get",
        description: "Get current weather for a city",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
          },
          required: ["city"],
        },
        security: { level: "read" },
        execute: async (params: unknown) => {
          const { city } = params as { city: string };
          const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
          const res = await mockFetch(url);

          if (!res.ok) {
            return { success: false, error: "API error" };
          }

          const data = await res.json();
          const current = data.current_condition[0];
          const location = data.nearest_area?.[0];

          return {
            success: true,
            data: {
              city: location?.areaName?.[0]?.value || city,
              country: location?.country?.[0]?.value || null,
              temperature: `${current.temp_C}°C`,
            },
          };
        },
      };

      toolRegistry.register(weatherTool);

      // Create WriteGate (should NOT be triggered for read tools)
      const writeGate = new WriteGate(
        {
          allowList: ["test-user"],
          confirmationEnabled: true,
          timeoutMs: 5000,
          auditPath: AUDIT_PATH,
        },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      const result = await toolRouter.callTool(
        "weather__get",
        { city: "London" },
        {
          userId: "test-user",
          sessionId: "test-session",
          channel: "discord",
          target: "channel-123",
        }
      );

      // Verify successful execution
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        city: "London",
        country: "United Kingdom",
        temperature: "20°C",
      });

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalledWith(
        "https://wttr.in/London?format=j1"
      );

      // Verify NO confirmation messages were sent (read tool)
      expect(mockChannel.sentMessages).toHaveLength(0);

      // Verify audit log was written
      expect(mockAuditLogger.entries).toHaveLength(1);
      expect(mockAuditLogger.entries[0]).toMatchObject({
        tool: "weather__get",
        securityLevel: "read",
        result: "success",
      });
    });

    it("handles read tool errors gracefully", async () => {
      const errorTool: ToolDefinition = {
        name: "failing__read",
        description: "A read tool that fails",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: async () => {
          throw new Error("Network error");
        },
      };

      toolRegistry.register(errorTool);

      const writeGate = new WriteGate(
        {
          allowList: [],
          confirmationEnabled: false,
          timeoutMs: 5000,
          auditPath: AUDIT_PATH,
        },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      const result = await toolRouter.callTool(
        "failing__read",
        {},
        {
          userId: "test-user",
          sessionId: "test-session",
          channel: "discord",
          target: "channel-123",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");

      // Verify error was logged
      expect(mockAuditLogger.entries[0].result).toBe("error");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Write Tool Execution Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe("Write Tool Execution (WriteGate)", () => {
    let todoFilePath: string;

    beforeEach(async () => {
      todoFilePath = join(TMP_WORKSPACE, "todo.md");
      await rm(todoFilePath, { force: true });
    });

    it("triggers WriteGate confirmation for write tools and allows on approval", async () => {
      // Create a mock todo add tool
      const todoAddTool: ToolDefinition = {
        name: "todo__add",
        description: "Add a todo item",
        parameters: {
          type: "object",
          properties: {
            item: { type: "string", description: "The todo item" },
          },
          required: ["item"],
        },
        security: { level: "write" },
        execute: async (params: unknown) => {
          const { item } = params as { item: string };
          let content = "# Todo List\n\n";
          try {
            content = await readFile(todoFilePath, "utf-8");
          } catch {
            // File doesn't exist, use default
          }
          content += `- [ ] ${item}\n`;
          await writeFile(todoFilePath, content, "utf-8");
          return {
            success: true,
            data: { action: "added", item },
          };
        },
      };

      toolRegistry.register(todoAddTool);

      const writeGate = new WriteGate(
        {
          allowList: ["test-user"],
          confirmationEnabled: true,
          timeoutMs: 5000,
          auditPath: AUDIT_PATH,
        },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      // Set mock to approve
      mockChannel.setReply("channel-123", "yes");

      const result = await toolRouter.callTool(
        "todo__add",
        { item: "Buy groceries" },
        {
          userId: "test-user",
          sessionId: "test-session",
          channel: "discord",
          target: "channel-123",
        }
      );

      // Verify confirmation was requested
      expect(mockChannel.sentMessages.length).toBeGreaterThan(0);
      expect(mockChannel.sentMessages[0].text).toContain("Write Operation Requested");
      expect(mockChannel.sentMessages[0].text).toContain("todo__add");

      // Verify tool executed successfully after approval
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        action: "added",
        item: "Buy groceries",
      });

      // Verify file was written
      const fileContent = await readFile(todoFilePath, "utf-8");
      expect(fileContent).toContain("- [ ] Buy groceries");

      // Verify audit log
      const auditEntry = mockAuditLogger.entries.find((e) => e.tool === "todo__add");
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.result).toBe("success");
      expect(auditEntry?.gate).toBe("WriteGate");
    });

    it("denies write tool when user is not in allowlist", async () => {
      const todoAddTool: ToolDefinition = {
        name: "todo__add",
        description: "Add a todo item",
        parameters: {
          type: "object",
          properties: {
            item: { type: "string", description: "The todo item" },
          },
          required: ["item"],
        },
        security: { level: "write" },
        execute: async () => ({ success: true, data: {} }),
      };

      toolRegistry.register(todoAddTool);

      // User NOT in allowlist
      const writeGate = new WriteGate(
        {
          allowList: ["other-user"],
          confirmationEnabled: true,
          timeoutMs: 5000,
          auditPath: AUDIT_PATH,
        },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      const result = await toolRouter.callTool(
        "todo__add",
        { item: "Malicious action" },
        {
          userId: "attacker",
          sessionId: "test-session",
          channel: "discord",
          target: "channel-123",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied");

      // Verify no confirmation was even requested
      expect(mockChannel.sentMessages).toHaveLength(0);

      // Verify audit log shows denial
      expect(mockAuditLogger.entries[0].result).toBe("denied");
      expect(mockAuditLogger.entries[0].gateDecision).toBe("not_in_allowlist");
    });

    it("denies write tool when user rejects confirmation", async () => {
      const todoAddTool: ToolDefinition = {
        name: "todo__add",
        description: "Add a todo item",
        parameters: {
          type: "object",
          properties: {
            item: { type: "string", description: "The todo item" },
          },
          required: ["item"],
        },
        security: { level: "write" },
        execute: async () => ({ success: true, data: {} }),
      };

      toolRegistry.register(todoAddTool);

      const writeGate = new WriteGate(
        {
          allowList: ["test-user"],
          confirmationEnabled: true,
          timeoutMs: 5000,
          auditPath: AUDIT_PATH,
        },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      // Set mock to reject
      mockChannel.setReply("channel-123", "no");

      const result = await toolRouter.callTool(
        "todo__add",
        { item: "Something suspicious" },
        {
          userId: "test-user",
          sessionId: "test-session",
          channel: "discord",
          target: "channel-123",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied");

      // Verify audit shows rejection
      expect(mockAuditLogger.entries[0].result).toBe("denied");
      expect(mockAuditLogger.entries[0].gateDecision).toBe("denied");
    });

    it("allows write tool without confirmation when confirmation is disabled", async () => {
      const todoAddTool: ToolDefinition = {
        name: "todo__add",
        description: "Add a todo item",
        parameters: {
          type: "object",
          properties: {
            item: { type: "string", description: "The todo item" },
          },
          required: ["item"],
        },
        security: { level: "write" },
        execute: async (params: unknown) => {
          const { item } = params as { item: string };
          await writeFile(todoFilePath, `- [ ] ${item}\n`, "utf-8");
          return { success: true, data: { item } };
        },
      };

      toolRegistry.register(todoAddTool);

      // Confirmation disabled
      const writeGate = new WriteGate(
        {
          allowList: ["test-user"],
          confirmationEnabled: false,
          timeoutMs: 5000,
          auditPath: AUDIT_PATH,
        },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      const result = await toolRouter.callTool(
        "todo__add",
        { item: "Auto-approved item" },
        {
          userId: "test-user",
          sessionId: "test-session",
          channel: "discord",
          target: "channel-123",
        }
      );

      expect(result.success).toBe(true);

      // Verify NO confirmation message was sent
      expect(mockChannel.sentMessages).toHaveLength(0);

      // Verify audit shows it was allowed without confirmation
      expect(mockAuditLogger.entries[0].gateDecision).toBe(
        "confirmation_disabled_allow"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Sign Tool Execution Tests (TierPolicy)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Sign Tool Execution (TierPolicy)", () => {
    it("allows Tier 3 sign operation automatically without confirmation", async () => {
      const signerRouter = new SignerRouter({
        policyEngine: mockPolicyEngine as unknown as PolicyEngine,
        signerService: mockSignerService,
        confirmationTimeoutMs: 5000,
      });

      // Policy returns Tier 3 (allow)
      mockPolicyEngine.setNextDecision({
        action: "allow",
        tier: 3,
        effectiveTier: 3,
        signerTier: "session-key",
      });

      const context: SignerRouterContext = {
        userId: "test-user",
        sessionId: "test-session",
        channel: "discord",
        askConfirmation: vi.fn().mockResolvedValue(true),
      };

      const result = await signerRouter.callSigner(
        {
          operation: "transfer",
          params: { token: "ETH", to: "0x" + "1".repeat(40), amount: "0.01" },
          estimatedValueUsd: 25, // Under Tier 3 threshold
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.data?.txHash).toBeDefined();

      // Verify NO confirmation was requested (Tier 3 auto-executes)
      expect(context.askConfirmation).not.toHaveBeenCalled();

      // Verify signer was called with session-key tier
      expect(mockSignerService.executedOperations).toHaveLength(1);
      expect(mockSignerService.executedOperations[0].signerTier).toBe("session-key");
    });

    it("requires inline confirmation for Tier 2 operations", async () => {
      const signerRouter = new SignerRouter({
        policyEngine: mockPolicyEngine as unknown as PolicyEngine,
        signerService: mockSignerService,
        confirmationTimeoutMs: 5000,
      });

      // Policy returns Tier 2 (confirm)
      mockPolicyEngine.setNextDecision({
        action: "confirm",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        confirmationChannel: "inline",
      });

      const mockAskConfirmation = vi.fn().mockResolvedValue(true);

      const context: SignerRouterContext = {
        userId: "test-user",
        sessionId: "test-session",
        channel: "discord",
        askConfirmation: mockAskConfirmation,
      };

      const result = await signerRouter.callSigner(
        {
          operation: "transfer",
          params: { token: "ETH", to: "0x" + "2".repeat(40), amount: "1.0" },
          estimatedValueUsd: 200, // Tier 2 range
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.confirmationRequired).toBe(true);

      // Verify confirmation WAS requested
      expect(mockAskConfirmation).toHaveBeenCalledTimes(1);
      expect(mockAskConfirmation).toHaveBeenCalledWith(
        expect.stringContaining("Confirm")
      );
    });

    it("denies operation when user rejects Tier 2 confirmation", async () => {
      const signerRouter = new SignerRouter({
        policyEngine: mockPolicyEngine as unknown as PolicyEngine,
        signerService: mockSignerService,
        confirmationTimeoutMs: 5000,
      });

      mockPolicyEngine.setNextDecision({
        action: "confirm",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        confirmationChannel: "inline",
      });

      // User rejects
      const mockAskConfirmation = vi.fn().mockResolvedValue(false);

      const context: SignerRouterContext = {
        userId: "test-user",
        sessionId: "test-session",
        channel: "discord",
        askConfirmation: mockAskConfirmation,
      };

      const result = await signerRouter.callSigner(
        {
          operation: "transfer",
          params: { token: "ETH", to: "0x" + "3".repeat(40), amount: "2.0" },
          estimatedValueUsd: 400,
        },
        context
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("User rejected");

      // Verify signer was NOT called
      expect(mockSignerService.executedOperations).toHaveLength(0);
    });

    it("denies operation when policy returns deny", async () => {
      const signerRouter = new SignerRouter({
        policyEngine: mockPolicyEngine as unknown as PolicyEngine,
        signerService: mockSignerService,
        confirmationTimeoutMs: 5000,
      });

      mockPolicyEngine.setNextDecision({
        action: "deny",
        tier: 1,
        effectiveTier: 1,
        signerTier: "app",
        reason: "Amount exceeds per-tool limit",
      });

      const context: SignerRouterContext = {
        userId: "test-user",
        sessionId: "test-session",
        channel: "discord",
        askConfirmation: vi.fn(),
      };

      const result = await signerRouter.callSigner(
        {
          operation: "transfer",
          params: { token: "ETH", to: "0x" + "4".repeat(40), amount: "100.0" },
          estimatedValueUsd: 200000,
        },
        context
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Amount exceeds per-tool limit");

      // Verify signer was NOT called
      expect(mockSignerService.executedOperations).toHaveLength(0);
    });

    it("escalates to Tier 1 when session key is unavailable", async () => {
      // Make session key unavailable
      const signerServiceNoSession: SignerService = {
        ...mockSignerService,
        getSessionKeyStatus: async () => ({
          available: false,
          expired: true,
          revoked: false,
        }),
      };

      const signerRouter = new SignerRouter({
        policyEngine: mockPolicyEngine as unknown as PolicyEngine,
        signerService: signerServiceNoSession,
        confirmationTimeoutMs: 5000,
      });

      mockPolicyEngine.setNextDecision({
        action: "escalate",
        tier: 2,
        effectiveTier: 1,
        signerTier: "app",
        reason: "session-key-unavailable",
        confirmationChannel: "companion-app",
      });

      const context: SignerRouterContext = {
        userId: "test-user",
        sessionId: "test-session",
        channel: "discord",
        askConfirmation: vi.fn(),
        sendMessage: vi.fn(),
      };

      const result = await signerRouter.callSigner(
        {
          operation: "transfer",
          params: { token: "ETH", to: "0x" + "5".repeat(40), amount: "0.5" },
          estimatedValueUsd: 100,
        },
        context
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Companion App");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Audit Logging Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe("Audit Logging", () => {
    it("logs all required fields for read tool calls", async () => {
      const readTool: ToolDefinition = {
        name: "test__read",
        description: "Test read tool",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: async () => ({ success: true, data: { result: "ok" } }),
      };

      toolRegistry.register(readTool);

      const writeGate = new WriteGate(
        { allowList: [], confirmationEnabled: false, timeoutMs: 1000, auditPath: AUDIT_PATH },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      await toolRouter.callTool("test__read", { query: "test query that is longer than 100 characters to verify truncation works properly in the audit log" }, {
        userId: "audit-test-user",
        sessionId: "audit-test-session",
        channel: "telegram",
        target: "chat-456",
      });

      expect(mockAuditLogger.entries).toHaveLength(1);
      const entry = mockAuditLogger.entries[0];

      // Verify all required fields
      expect(entry.ts).toBeDefined();
      expect(new Date(entry.ts).getTime()).toBeGreaterThan(0);
      expect(entry.tool).toBe("test__read");
      expect(entry.securityLevel).toBe("read");
      expect(entry.userId).toBe("audit-test-user");
      expect(entry.sessionId).toBe("audit-test-session");
      expect(entry.channel).toBe("telegram");
      expect(entry.result).toBe("success");
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);

      // Verify params are sanitized (truncated)
      expect(entry.params.query).toBeDefined();
      expect((entry.params.query as string).length).toBeLessThanOrEqual(103); // 100 + "…"
    });

    it("logs gate decision for write tool calls", async () => {
      const writeTool: ToolDefinition = {
        name: "test__write",
        description: "Test write tool",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        security: { level: "write" },
        execute: async () => ({ success: true, data: {} }),
      };

      toolRegistry.register(writeTool);

      const writeGate = new WriteGate(
        { allowList: ["audit-user"], confirmationEnabled: true, timeoutMs: 1000, auditPath: AUDIT_PATH },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      // Approve confirmation
      mockChannel.setReply("chat-789", "yes");

      await toolRouter.callTool("test__write", { path: "/test/file.txt" }, {
        userId: "audit-user",
        sessionId: "audit-session",
        channel: "discord",
        target: "chat-789",
      });

      expect(mockAuditLogger.entries).toHaveLength(1);
      const entry = mockAuditLogger.entries[0];

      expect(entry.tool).toBe("test__write");
      expect(entry.securityLevel).toBe("write");
      expect(entry.gate).toBe("WriteGate");
      expect(entry.gateDecision).toBe("approved");
      expect(entry.result).toBe("success");

      // Verify path is preserved in params
      expect(entry.params.path).toBe("/test/file.txt");
    });

    it("logs error details when tool execution fails", async () => {
      const errorTool: ToolDefinition = {
        name: "test__error",
        description: "Tool that throws",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: async () => {
          throw new Error("Simulated database connection error");
        },
      };

      toolRegistry.register(errorTool);

      const writeGate = new WriteGate(
        { allowList: [], confirmationEnabled: false, timeoutMs: 1000, auditPath: AUDIT_PATH },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      await toolRouter.callTool("test__error", {}, {
        userId: "error-user",
        sessionId: "error-session",
        channel: "discord",
        target: "error-channel",
      });

      expect(mockAuditLogger.entries).toHaveLength(1);
      const entry = mockAuditLogger.entries[0];

      expect(entry.result).toBe("error");
      expect(entry.error).toContain("Simulated database connection error");
    });

    it("logs tool_not_found when calling non-existent tool", async () => {
      const writeGate = new WriteGate(
        { allowList: [], confirmationEnabled: false, timeoutMs: 1000, auditPath: AUDIT_PATH },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry, // Empty registry
        auditLogger: mockAuditLogger,
      });

      const result = await toolRouter.callTool("nonexistent__tool", {}, {
        userId: "user",
        sessionId: "session",
        channel: "discord",
        target: "channel",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool not found");

      expect(mockAuditLogger.entries).toHaveLength(1);
      expect(mockAuditLogger.entries[0].result).toBe("tool_not_found");
    });

    it("measures execution duration accurately", async () => {
      const slowTool: ToolDefinition = {
        name: "test__slow",
        description: "Slow tool for timing test",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { success: true, data: {} };
        },
      };

      toolRegistry.register(slowTool);

      const writeGate = new WriteGate(
        { allowList: [], confirmationEnabled: false, timeoutMs: 1000, auditPath: AUDIT_PATH },
        mockChannel
      );

      toolRouter = new ToolRouter({
        writeGate,
        toolRegistry,
        auditLogger: mockAuditLogger,
      });

      await toolRouter.callTool("test__slow", {}, {
        userId: "timing-user",
        sessionId: "timing-session",
        channel: "discord",
        target: "timing-channel",
      });

      expect(mockAuditLogger.entries).toHaveLength(1);
      expect(mockAuditLogger.entries[0].durationMs).toBeGreaterThanOrEqual(45); // Allow some timing variance
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Integration: Full Pipeline Test
  // ─────────────────────────────────────────────────────────────────────────

  describe("Full Pipeline Integration", () => {
    it("loads skills, registers tools, and executes through router", async () => {
      // Load actual builtin skills
      const loadResult = await loadSkills(BUILTIN_SKILLS_DIR);
      expect(loadResult.failed).toHaveLength(0);

      // Register all tools
      for (const skill of loadResult.loaded) {
        const toolDefs = skillToToolDefinitions(skill);
        for (const tool of toolDefs) {
          toolRegistry.register(tool);
        }
      }

      // Verify tools are registered with correct names
      const registeredTools = toolRegistry.list();
      expect(registeredTools.some((t) => t.name === "weather__get")).toBe(true);
      expect(registeredTools.some((t) => t.name === "todo__add")).toBe(true);
      expect(registeredTools.some((t) => t.name === "todo__list")).toBe(true);
      expect(registeredTools.some((t) => t.name === "transfer__send")).toBe(true);

      // Verify security levels are correct
      const weatherGet = registeredTools.find((t) => t.name === "weather__get");
      const todoAdd = registeredTools.find((t) => t.name === "todo__add");
      const transferSend = registeredTools.find((t) => t.name === "transfer__send");

      expect(weatherGet?.security.level).toBe("read");
      expect(todoAdd?.security.level).toBe("write");
      expect(transferSend?.security.level).toBe("sign");
    });
  });
});
