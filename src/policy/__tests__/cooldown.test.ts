import { describe, it, expect, beforeEach } from "vitest";
import { CooldownTracker } from "../cooldown.js";
import type { ResolvedPolicy } from "../types.js";

describe("CooldownTracker", () => {
  let tracker: CooldownTracker;
  let policy: ResolvedPolicy;

  beforeEach(() => {
    tracker = new CooldownTracker();
    policy = {
      tier: 3,
      requireConfirmation: false,
      confirmationChannel: "inline",
      allowedUsers: "assignee-only",
      timeout: 120,
      cooldown: {
        maxPerHour: 5,
        maxPerDay: 20,
      },
    };
  });

  it("should allow first execution", () => {
    const result = tracker.check("test-tool", policy);
    expect(result.allowed).toBe(true);
  });

  it("should track executions", () => {
    tracker.record("test-tool", policy);
    const state = tracker.getState("test-tool");
    expect(state?.hourlyCount).toBe(1);
    expect(state?.dailyCount).toBe(1);
  });

  it("should enforce hourly limit", () => {
    // Execute 5 times
    for (let i = 0; i < 5; i++) {
      tracker.record("test-tool", policy);
    }

    // 6th attempt should be blocked
    const result = tracker.check("test-tool", policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Hourly limit exceeded");
  });

  it("should reset after cooldown period", async () => {
    tracker.record("test-tool", policy);
    
    // Simulate time passing by directly modifying state
    const state = tracker.getState("test-tool");
    if (state) {
      state.hourlyResetAt = Date.now() - 1000; // Expired 1 second ago
      state.hourlyCount = 10; // Way over limit
    }

    // Should allow now
    const result = tracker.check("test-tool", policy);
    expect(result.allowed).toBe(true);
  });

  it("should handle tools without cooldown", () => {
    const noCooldownPolicy: ResolvedPolicy = {
      ...policy,
      cooldown: undefined,
    };

    const result = tracker.check("test-tool", noCooldownPolicy);
    expect(result.allowed).toBe(true);

    // Should not track
    tracker.record("test-tool", noCooldownPolicy);
    const state = tracker.getState("test-tool");
    expect(state).toBeUndefined();
  });
});
