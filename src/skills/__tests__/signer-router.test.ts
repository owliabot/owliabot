/**
 * Tests for SignerRouter - routing skill signer calls through TierPolicy
 * @see docs/design/skill-system.md Section 3.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignerRouter, TimeoutError } from "../signer-router.js";
import type { SignerRouterOptions } from "../signer-router.js";
import type {
  SignerService,
  SignerCall,
  SignerRouterContext,
  SignerResult,
  SessionKeyStatus,
} from "../signer-service-interface.js";
import type { PolicyEngine } from "../../policy/engine.js";
import type { PolicyDecision, EscalationContext } from "../../policy/types.js";
import type { AuditLogger, PreLogResult } from "../../audit/logger.js";
import type { SignerTier } from "../../signer/interface.js";

// Mock logger to suppress logs during tests
vi.mock("../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ============================================================================
// Test Fixtures & Mocks
// ============================================================================

function createMockPolicyEngine(
  decisionOverride?: Partial<PolicyDecision>
): PolicyEngine {
  return {
    decide: vi.fn().mockResolvedValue({
      action: "allow",
      tier: 3,
      effectiveTier: 3,
      signerTier: "session-key",
      ...decisionOverride,
    } as PolicyDecision),
    getThresholds: vi.fn().mockResolvedValue({
      tier3MaxUsd: 5,
      tier2MaxUsd: 50,
      tier2DailyUsd: 200,
    }),
    resolve: vi.fn(),
    reload: vi.fn(),
  } as unknown as PolicyEngine;
}

function createMockSignerService(
  resultOverride?: Partial<SignerResult>
): SignerService {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { txHash: "0xabc123" },
      ...resultOverride,
    } as SignerResult),
    canExecute: vi.fn().mockReturnValue(true),
    getSessionKeyStatus: vi.fn().mockResolvedValue({
      id: "sk-001",
      available: true,
      expired: false,
      revoked: false,
    } as SessionKeyStatus),
  };
}

function createMockAuditLogger(): AuditLogger {
  return {
    preLog: vi.fn().mockResolvedValue({ ok: true, id: "audit-001" } as PreLogResult),
    finalize: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogger;
}

function createMockContext(overrides?: Partial<SignerRouterContext>): SignerRouterContext {
  return {
    userId: "user-123",
    sessionId: "session-456",
    channel: "discord",
    askConfirmation: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    dailySpentUsd: 0,
    consecutiveDenials: 0,
    ...overrides,
  };
}

function createTestCall(overrides?: Partial<SignerCall>): SignerCall {
  return {
    operation: "transfer__send_token",
    params: {
      token: "USDC",
      to: "0x1234567890abcdef1234567890abcdef12345678",
      amount: "100",
    },
    estimatedValueUsd: 10,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SignerRouter", () => {
  let router: SignerRouter;
  let mockPolicyEngine: PolicyEngine;
  let mockSignerService: SignerService;
  let mockAuditLogger: AuditLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPolicyEngine = createMockPolicyEngine();
    mockSignerService = createMockSignerService();
    mockAuditLogger = createMockAuditLogger();

    router = new SignerRouter({
      policyEngine: mockPolicyEngine,
      signerService: mockSignerService,
      auditLogger: mockAuditLogger,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Tier 3 (allow): auto-execute without confirmation
  // ==========================================================================
  describe("Tier 3 (allow) - auto-execute", () => {
    it("should auto-execute without confirmation", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "allow",
        tier: 3,
        effectiveTier: 3,
        signerTier: "session-key",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext();
      const call = createTestCall({ estimatedValueUsd: 3 }); // Under tier3 limit

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(true);
      expect(result.data?.txHash).toBe("0xabc123");
      expect(context.askConfirmation).not.toHaveBeenCalled();
      expect(mockSignerService.execute).toHaveBeenCalledWith(
        call.operation,
        call.params,
        "session-key"
      );
    });

    it("should include audit ID in result", async () => {
      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.auditId).toBe("audit-001");
      expect(mockAuditLogger.preLog).toHaveBeenCalled();
      expect(mockAuditLogger.finalize).toHaveBeenCalledWith(
        "audit-001",
        "success",
        undefined,
        { txHash: "0xabc123" }
      );
    });

    it("should report effectiveTier in result", async () => {
      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.effectiveTier).toBe(3);
      expect(result.confirmationRequired).toBe(false);
    });
  });

  // ==========================================================================
  // Tier 2 (confirm): inline confirmation required
  // ==========================================================================
  describe("Tier 2 (confirm) - inline confirmation", () => {
    beforeEach(() => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "confirm",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        confirmationChannel: "inline",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });
    });

    it("should request inline confirmation and execute on yes", async () => {
      const context = createMockContext({
        askConfirmation: vi.fn().mockResolvedValue(true),
      });
      const call = createTestCall({ estimatedValueUsd: 25 });

      const result = await router.callSigner(call, context);

      expect(context.askConfirmation).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.confirmationRequired).toBe(true);
      expect(mockSignerService.execute).toHaveBeenCalled();
    });

    it("should return error on user rejection (no)", async () => {
      const context = createMockContext({
        askConfirmation: vi.fn().mockResolvedValue(false),
      });
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe("User rejected");
      expect(mockSignerService.execute).not.toHaveBeenCalled();
    });

    it("should format confirmation message with amount", async () => {
      const askConfirmation = vi.fn().mockResolvedValue(true);
      const context = createMockContext({ askConfirmation });
      const call = createTestCall({
        operation: "dex-swap__swap",
        estimatedValueUsd: 45.5,
        params: { token: "ETH", amount: "0.5", to: "0xabcd1234" },
      });

      await router.callSigner(call, context);

      const confirmMsg = askConfirmation.mock.calls[0][0];
      expect(confirmMsg).toContain("Confirm");
      expect(confirmMsg).toContain("Dex Swap"); // humanized operation
      expect(confirmMsg).toContain("$45.50"); // formatted amount
    });

    it("should timeout if confirmation takes too long", async () => {
      const askConfirmation = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            // Never resolves within timeout
            setTimeout(resolve, 200_000);
          })
      );
      const context = createMockContext({ askConfirmation });
      const call = createTestCall();

      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
        confirmationTimeoutMs: 5000,
      });

      const resultPromise = router.callSigner(call, context);

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(6000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Confirmation timed out");
    });

    it("should log audit with denied status on rejection", async () => {
      const context = createMockContext({
        askConfirmation: vi.fn().mockResolvedValue(false),
      });
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockAuditLogger.finalize).toHaveBeenCalledWith(
        "audit-001",
        "denied",
        "User rejected",
        undefined
      );
    });
  });

  // ==========================================================================
  // Tier 1 (escalate): Companion App required
  // ==========================================================================
  describe("Tier 1 (escalate) - Companion App", () => {
    beforeEach(() => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "escalate",
        tier: 2,
        effectiveTier: 1,
        signerTier: "app",
        confirmationChannel: "companion-app",
        reason: "tier2-max-exceeded",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });
    });

    it("should return not-implemented error for Tier 1", async () => {
      const context = createMockContext();
      const call = createTestCall({ estimatedValueUsd: 100 });

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tier 1");
      expect(result.error).toContain("not yet implemented");
      expect(mockSignerService.execute).not.toHaveBeenCalled();
    });

    it("should send waiting message to user", async () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const context = createMockContext({ sendMessage });
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("Companion App")
      );
    });

    it("should return confirm channel as companion-app when policy requires it", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "confirm",
        tier: 1,
        effectiveTier: 1,
        signerTier: "app",
        confirmationChannel: "companion-app",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Companion App confirmation not yet implemented");
    });
  });

  // ==========================================================================
  // Deny: return error with reason
  // ==========================================================================
  describe("Deny - policy rejection", () => {
    it("should return error with policy reason", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "deny",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        reason: "Amount exceeds tool limit (max: $50)",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext();
      const call = createTestCall({ estimatedValueUsd: 100 });

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Amount exceeds tool limit (max: $50)");
      expect(mockSignerService.execute).not.toHaveBeenCalled();
    });

    it("should deny on consecutive denials halt", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "deny",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        reason: "consecutive-denials-halt",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext({ consecutiveDenials: 3 });
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe("consecutive-denials-halt");
    });

    it("should provide default reason if none given", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "deny",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        reason: undefined,
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Operation denied by policy");
    });
  });

  // ==========================================================================
  // Audit logging on all outcomes
  // ==========================================================================
  describe("Audit logging", () => {
    it("should pre-log before execution", async () => {
      const context = createMockContext();
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockAuditLogger.preLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: call.operation,
          securityLevel: "sign",
          user: context.userId,
          channel: context.channel,
          amountUsd: call.estimatedValueUsd,
        })
      );
    });

    it("should block execution if audit pre-log fails (fail-closed)", async () => {
      (mockAuditLogger.preLog as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        id: "",
        error: "Disk full",
      });

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Audit log write failed");
      expect(mockSignerService.execute).not.toHaveBeenCalled();
    });

    it("should finalize audit with success on successful execution", async () => {
      const context = createMockContext();
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockAuditLogger.finalize).toHaveBeenCalledWith(
        "audit-001",
        "success",
        undefined,
        { txHash: "0xabc123" }
      );
    });

    it("should finalize audit with denied on user rejection", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "confirm",
        tier: 2,
        effectiveTier: 2,
        signerTier: "session-key",
        confirmationChannel: "inline",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext({
        askConfirmation: vi.fn().mockResolvedValue(false),
      });
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockAuditLogger.finalize).toHaveBeenCalledWith(
        "audit-001",
        "denied",
        "User rejected",
        undefined
      );
    });

    it("should finalize audit with error on execution failure", async () => {
      (mockSignerService.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("RPC timeout")
      );

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe("RPC timeout");
      expect(mockAuditLogger.finalize).toHaveBeenCalledWith(
        "audit-001",
        "error",
        "RPC timeout"
      );
    });

    it("should work without audit logger (optional)", async () => {
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        // No audit logger
      });

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(true);
      expect(result.auditId).toBeUndefined();
    });
  });

  // ==========================================================================
  // Session key and escalation context
  // ==========================================================================
  describe("Escalation context building", () => {
    it("should pass session key status to policy engine", async () => {
      const context = createMockContext({ dailySpentUsd: 50 });
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockPolicyEngine.decide).toHaveBeenCalledWith(
        call.operation,
        call.params,
        expect.objectContaining({
          sessionKey: expect.objectContaining({
            id: "sk-001",
            expired: false,
            revoked: false,
          }),
          dailySpentUsd: 50,
        })
      );
    });

    it("should escalate when session key unavailable", async () => {
      (mockSignerService.getSessionKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        available: false,
        expired: true,
        revoked: false,
      } as SessionKeyStatus);

      // Policy engine would return escalate based on unavailable session key
      mockPolicyEngine = createMockPolicyEngine({
        action: "escalate",
        tier: 2,
        effectiveTier: 1,
        signerTier: "app",
        reason: "session-key-unavailable",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tier 1");
    });

    it("should pass thresholds from policy engine", async () => {
      const context = createMockContext();
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockPolicyEngine.getThresholds).toHaveBeenCalled();
      expect(mockPolicyEngine.decide).toHaveBeenCalledWith(
        call.operation,
        call.params,
        expect.objectContaining({
          thresholds: {
            tier3MaxUsd: 5,
            tier2MaxUsd: 50,
            tier2DailyUsd: 200,
          },
        })
      );
    });
  });

  // ==========================================================================
  // Signer service interaction
  // ==========================================================================
  describe("Signer service interaction", () => {
    it("should check canExecute before execution", async () => {
      const context = createMockContext();
      const call = createTestCall();

      await router.callSigner(call, context);

      expect(mockSignerService.canExecute).toHaveBeenCalledWith("session-key");
    });

    it("should return error if signer cannot execute tier", async () => {
      (mockSignerService.canExecute as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const context = createMockContext();
      const call = createTestCall();

      const result = await router.callSigner(call, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Signer not available");
    });

    it("should pass signerTier from policy decision", async () => {
      mockPolicyEngine = createMockPolicyEngine({
        action: "allow",
        tier: "none",
        effectiveTier: "none",
        signerTier: "none",
      });
      router = new SignerRouter({
        policyEngine: mockPolicyEngine,
        signerService: mockSignerService,
        auditLogger: mockAuditLogger,
      });

      const context = createMockContext();
      const call = createTestCall({ operation: "read__get_balance" });

      await router.callSigner(call, context);

      expect(mockSignerService.execute).toHaveBeenCalledWith(
        call.operation,
        call.params,
        "none"
      );
    });
  });
});

// ==========================================================================
// TimeoutError tests
// ==========================================================================
describe("TimeoutError", () => {
  it("should have correct name property", () => {
    const error = new TimeoutError("test message");
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe("test message");
  });

  it("should be instanceof Error", () => {
    const error = new TimeoutError("test");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TimeoutError);
  });
});
