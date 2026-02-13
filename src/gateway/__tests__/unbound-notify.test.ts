import { describe, it, expect } from "vitest";
import { UnboundNotifier } from "../unbound-notify.js";

describe("UnboundNotifier", () => {
  it("returns message on first call for a user", () => {
    const n = new UnboundNotifier();
    const msg = n.shouldNotify("user1");
    expect(msg).toBeTruthy();
    expect(msg).toContain("⚠️");
  });

  it("suppresses repeated notifications within cooldown", () => {
    const n = new UnboundNotifier({ cooldownMs: 1000 });
    const now = 10_000;
    expect(n.shouldNotify("user1", now)).toBeTruthy();
    expect(n.shouldNotify("user1", now + 500)).toBeNull();
    expect(n.shouldNotify("user1", now + 999)).toBeNull();
  });

  it("allows notification after cooldown expires", () => {
    const n = new UnboundNotifier({ cooldownMs: 1000 });
    const now = 10_000;
    expect(n.shouldNotify("user1", now)).toBeTruthy();
    expect(n.shouldNotify("user1", now + 1000)).toBeTruthy();
  });

  it("tracks users independently", () => {
    const n = new UnboundNotifier({ cooldownMs: 1000 });
    const now = 10_000;
    expect(n.shouldNotify("user1", now)).toBeTruthy();
    expect(n.shouldNotify("user2", now)).toBeTruthy();
    expect(n.shouldNotify("user1", now + 500)).toBeNull();
    expect(n.shouldNotify("user2", now + 500)).toBeNull();
  });

  it("uses custom message when provided", () => {
    const custom = "Please onboard!";
    const n = new UnboundNotifier({ message: custom });
    expect(n.shouldNotify("user1")).toBe(custom);
  });

  it("uses default message when none provided", () => {
    const n = new UnboundNotifier();
    const msg = n.shouldNotify("user1");
    expect(msg).toContain("你还没有绑定");
    expect(msg).toContain("You're not bound yet");
  });
});
