import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../engine.js";
import type { EscalationContext } from "../types.js";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;
  let context: EscalationContext;

  beforeEach(() => {
    engine = new PolicyEngine("workspace/policy.yml");
    context = {
      thresholds: {
        tier3MaxUsd: 5,
        tier2MaxUsd: 50,
        tier2DailyUsd: 200,
      },
      dailySpentUsd: 0,
      consecutiveDenials: 0,
    };
  });

  it("should resolve exact tool match", async () => {
    const policy = await engine.resolve("echo");
    expect(policy.tier).toBe("none");
  });

  it("should resolve wildcard match", async () => {
    const policy = await engine.resolve("crypto__get_price");
    expect(policy.tier).toBe("none");
  });

  it("should use fallback for unknown tools", async () => {
    const policy = await engine.resolve("unknown__dangerous_operation");
    expect(policy.tier).toBe(1);
    expect(policy.requireConfirmation).toBe(true);
  });

  it("should allow Tier none operations", async () => {
    const decision = await engine.decide("echo", {}, context);
    expect(decision.action).toBe("allow");
    expect(decision.effectiveTier).toBe("none");
  });

  it("should escalate when session key unavailable", async () => {
    const ctxNoSession: EscalationContext = {
      ...context,
      sessionKey: {
        id: "sk_123",
        expired: true,
        revoked: false,
      },
    };
    const decision = await engine.decide("edit-file", {}, ctxNoSession);
    expect(decision.action).toBe("escalate");
    expect(decision.effectiveTier).toBe(1);
    expect(decision.reason).toBe("session-key-unavailable");
  });

  it("should escalate Tier 3 when amount exceeds threshold", async () => {
    const ctxWithAmount: EscalationContext = {
      ...context,
      amountUsd: 10, // exceeds tier3MaxUsd of 5
      sessionKey: { id: "sk_123", expired: false, revoked: false },
    };
    const decision = await engine.decide("gas__refuel", {}, ctxWithAmount);
    expect(decision.effectiveTier).toBe(2);
  });

  it("should require confirmation for Tier 2 tools", async () => {
    const ctxWithSession: EscalationContext = {
      ...context,
      sessionKey: { id: "sk_123", expired: false, revoked: false },
    };
    const decision = await engine.decide("dex-swap__swap", {}, ctxWithSession);
    expect(decision.action).toBe("confirm");
    expect(decision.confirmationChannel).toBe("inline");
  });

  it("should deny after consecutive denials", async () => {
    const ctxWithDenials: EscalationContext = {
      ...context,
      consecutiveDenials: 3,
      sessionKey: { id: "sk_123", expired: false, revoked: false },
    };
    const decision = await engine.decide("edit-file", {}, ctxWithDenials);
    expect(decision.action).toBe("deny");
    expect(decision.reason).toBe("consecutive-denials-halt");
  });

  it("should map tiers to correct signer", async () => {
    const tier1Decision = await engine.decide(
      "approve__set_allowance",
      {},
      { ...context, sessionKey: { id: "sk_123", expired: false, revoked: false } }
    );
    expect(tier1Decision.signerTier).toBe("app");

    const tier2Decision = await engine.decide(
      "defi__claim_rewards",
      {},
      { ...context, sessionKey: { id: "sk_123", expired: false, revoked: false } }
    );
    expect(tier2Decision.signerTier).toBe("session-key");
  });
});
