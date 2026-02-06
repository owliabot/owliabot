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

  it("should deny Tier 3 tool when amount exceeds per-tool maxAmount", async () => {
    const ctxWithAmount: EscalationContext = {
      ...context,
      amountUsd: 10, // exceeds gas__refuel maxAmount.usd of 5
    };
    const decision = await engine.decide("gas__refuel", {}, ctxWithAmount);
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("exceeds tool limit");
  });

  it("should allow Tier 3 tool when amount is within maxAmount", async () => {
    const ctxWithAmount: EscalationContext = {
      ...context,
      amountUsd: 4, // within gas__refuel maxAmount (5) and tier3MaxUsd (5)
    };
    const decision = await engine.decide("gas__refuel", {}, ctxWithAmount);
    expect(decision.action).toBe("allow");
    expect(decision.effectiveTier).toBe(3);
  });

  it("should require confirmation for Tier 2 tools", async () => {
    const decision = await engine.decide("dex-swap__swap", {}, context);
    expect(decision.action).toBe("confirm");
    expect(decision.confirmationChannel).toBe("inline");
  });

  it("should deny after consecutive denials", async () => {
    const ctxWithDenials: EscalationContext = {
      ...context,
      consecutiveDenials: 3,
    };
    const decision = await engine.decide("edit_file", {}, ctxWithDenials);
    expect(decision.action).toBe("deny");
    expect(decision.reason).toBe("consecutive-denials-halt");
  });

  it("should escalate when daily limit exceeded", async () => {
    const ctxWithSpending: EscalationContext = {
      ...context,
      dailySpentUsd: 180,
      amountUsd: 30, // 180 + 30 = 210 > tier2DailyUsd (200)
    };
    const decision = await engine.decide("dex-swap__swap", {}, ctxWithSpending);
    expect(decision.action).toBe("escalate");
    expect(decision.effectiveTier).toBe(1);
    expect(decision.reason).toBe("daily-limit-exceeded");
  });

  it("should escalate when amount exceeds tier2MaxUsd but within per-tool maxAmount", async () => {
    // Use a context where tier2MaxUsd is lower than per-tool maxAmount
    // dex-swap__swap has maxAmount.usd=50, so we set tier2MaxUsd=40
    const ctxWithAmount: EscalationContext = {
      thresholds: {
        tier3MaxUsd: 5,
        tier2MaxUsd: 40, // lower than per-tool maxAmount (50)
        tier2DailyUsd: 200,
      },
      dailySpentUsd: 0,
      consecutiveDenials: 0,
      amountUsd: 45, // exceeds tier2MaxUsd (40) but within per-tool maxAmount (50)
    };
    const decision = await engine.decide("dex-swap__swap", {}, ctxWithAmount);
    expect(decision.action).toBe("escalate");
    expect(decision.effectiveTier).toBe(1);
    expect(decision.reason).toBe("tier2-max-exceeded");
  });
});
