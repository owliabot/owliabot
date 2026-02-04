import { describe, it, expect } from "vitest";
import type { AppConfig } from "../types.js";

describe("onboarding types", () => {
  it("should allow importing AppConfig type", () => {
    const config: AppConfig = {
      workspace: "./workspace",
      providers: [
        {
          id: "anthropic",
          model: "claude-sonnet-4-5",
          apiKey: "oauth",
          priority: 1,
        },
      ],
    };

    expect(config.workspace).toBe("./workspace");
    expect(config.providers).toHaveLength(1);
  });

  it("should support discord config", () => {
    const config: AppConfig = {
      workspace: "./workspace",
      discord: {
        requireMentionInGuild: true,
        channelAllowList: ["channel1", "channel2"],
        memberAllowList: ["user1", "user2"],
      },
      providers: [],
    };

    expect(config.discord?.requireMentionInGuild).toBe(true);
    expect(config.discord?.channelAllowList).toHaveLength(2);
  });

  it("should support telegram config", () => {
    const config: AppConfig = {
      workspace: "./workspace",
      telegram: {
        allowList: ["user1", "user2"],
      },
      providers: [],
    };

    expect(config.telegram?.allowList).toHaveLength(2);
  });

  it("should support notifications config", () => {
    const config: AppConfig = {
      workspace: "./workspace",
      providers: [],
      notifications: {
        channel: "discord:123456",
      },
    };

    expect(config.notifications?.channel).toBe("discord:123456");
  });

  it("should support multiple provider types", () => {
    const config: AppConfig = {
      workspace: "./workspace",
      providers: [
        {
          id: "anthropic",
          model: "claude-sonnet-4-5",
          apiKey: "oauth",
          priority: 1,
        },
        {
          id: "openai",
          model: "gpt-4o",
          apiKey: "sk-test123",
          priority: 2,
        },
      ],
    };

    expect(config.providers).toHaveLength(2);
    expect(config.providers[0].id).toBe("anthropic");
    expect(config.providers[1].id).toBe("openai");
  });
});
