// src/skills/__tests__/context.test.ts
import { describe, it, expect, vi } from "vitest";
import { createSkillContext } from "../context.js";

describe("createSkillContext", () => {
  it("should create context with filtered env vars", () => {
    // Set test env vars
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.SECRET_TOKEN = "should-not-be-included";

    const context = createSkillContext({
      skillName: "crypto-balance",
      toolName: "get_balance",
      callId: "call-123",
      userId: "user-456",
      channel: "telegram",
      requiredEnv: ["ALCHEMY_API_KEY"],
    });

    expect(context.env.ALCHEMY_API_KEY).toBe("test-key");
    expect(context.env.SECRET_TOKEN).toBeUndefined();
  });

  it("should provide native fetch", () => {
    const context = createSkillContext({
      skillName: "test",
      toolName: "test",
      callId: "1",
      userId: "1",
      channel: "test",
      requiredEnv: [],
    });

    expect(context.fetch).toBe(globalThis.fetch);
  });

  it("should include correct meta info", () => {
    const context = createSkillContext({
      skillName: "crypto-price",
      toolName: "get_price",
      callId: "call-789",
      userId: "user-abc",
      channel: "discord",
      requiredEnv: [],
    });

    expect(context.meta).toEqual({
      skillName: "crypto-price",
      toolName: "get_price",
      callId: "call-789",
      userId: "user-abc",
      channel: "discord",
    });
  });
});
