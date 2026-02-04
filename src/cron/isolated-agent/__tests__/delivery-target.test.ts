import { describe, it, expect, vi } from "vitest";
import { resolveDeliveryTarget } from "../delivery-target.js";
import type { CronPayload } from "../../types.js";

describe("resolveDeliveryTarget", () => {
  const mockDeps = {
    getLastRoute: vi.fn(() => ({ channel: "telegram", to: "last-user" })),
  };

  it("returns off for non-agentTurn payload", () => {
    const payload: CronPayload = { kind: "systemEvent", text: "hi" };
    const result = resolveDeliveryTarget(payload, mockDeps);
    expect(result.mode).toBe("off");
  });

  it("returns off when deliver is false", () => {
    const payload: CronPayload = {
      kind: "agentTurn",
      message: "test",
      deliver: false,
    };
    const result = resolveDeliveryTarget(payload, mockDeps);
    expect(result.mode).toBe("off");
  });

  it("returns explicit when deliver is true", () => {
    const payload: CronPayload = {
      kind: "agentTurn",
      message: "test",
      deliver: true,
      channel: "discord",
      to: "chan-123",
    };
    const result = resolveDeliveryTarget(payload, mockDeps);
    expect(result.mode).toBe("explicit");
    expect(result.channel).toBe("discord");
    expect(result.to).toBe("chan-123");
  });

  it("returns auto when deliver is undefined", () => {
    const payload: CronPayload = {
      kind: "agentTurn",
      message: "test",
      channel: "slack",
      to: "user-456",
    };
    const result = resolveDeliveryTarget(payload, mockDeps);
    expect(result.mode).toBe("auto");
    expect(result.channel).toBe("slack");
    expect(result.to).toBe("user-456");
  });

  it("uses last route when channel is 'last'", () => {
    const payload: CronPayload = {
      kind: "agentTurn",
      message: "test",
      deliver: true,
      channel: "last",
    };
    const result = resolveDeliveryTarget(payload, mockDeps);
    expect(result.channel).toBe("telegram");
    expect(result.to).toBe("last-user");
  });

  it("uses last route when channel is empty", () => {
    const payload: CronPayload = {
      kind: "agentTurn",
      message: "test",
      deliver: true,
      channel: "",
    };
    const result = resolveDeliveryTarget(payload, mockDeps);
    expect(result.channel).toBe("telegram");
  });
});
