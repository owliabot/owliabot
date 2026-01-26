// src/skills/__tests__/context.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSkillContext } from "../context.js";

describe("createSkillContext", () => {
  // Save original env vars to restore after tests
  let originalAlchemyApiKey: string | undefined;
  let originalSecretToken: string | undefined;

  beforeEach(() => {
    originalAlchemyApiKey = process.env.ALCHEMY_API_KEY;
    originalSecretToken = process.env.SECRET_TOKEN;
  });

  afterEach(() => {
    // Restore original values (or delete if they didn't exist)
    if (originalAlchemyApiKey === undefined) {
      delete process.env.ALCHEMY_API_KEY;
    } else {
      process.env.ALCHEMY_API_KEY = originalAlchemyApiKey;
    }
    if (originalSecretToken === undefined) {
      delete process.env.SECRET_TOKEN;
    } else {
      process.env.SECRET_TOKEN = originalSecretToken;
    }
  });

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
