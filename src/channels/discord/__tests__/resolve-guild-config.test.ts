import { describe, it, expect } from "vitest";
import { resolveGuildConfig, type DiscordConfig } from "../index.js";

describe("resolveGuildConfig", () => {
  it("should return global defaults when no guild ID is provided", () => {
    const config: DiscordConfig = {
      token: "test-token",
      memberAllowList: ["user1", "user2"],
      channelAllowList: ["channel1"],
      requireMentionInGuild: false,
      adminUsers: ["admin1"],
    };

    const result = resolveGuildConfig(config, undefined);

    expect(result).toEqual({
      memberAllowList: ["user1", "user2"],
      channelAllowList: ["channel1"],
      requireMentionInGuild: false,
      adminUsers: ["admin1"],
    });
  });

  it("should return global defaults when no per-guild config exists", () => {
    const config: DiscordConfig = {
      token: "test-token",
      memberAllowList: ["user1"],
      channelAllowList: ["channel1"],
      requireMentionInGuild: true,
      adminUsers: ["admin1"],
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result).toEqual({
      memberAllowList: ["user1"],
      channelAllowList: ["channel1"],
      requireMentionInGuild: true,
      adminUsers: ["admin1"],
    });
  });

  it("should use guild-specific overrides when available", () => {
    const config: DiscordConfig = {
      token: "test-token",
      memberAllowList: ["user1"],
      channelAllowList: ["channel1"],
      requireMentionInGuild: true,
      adminUsers: ["admin1"],
      guilds: {
        guild123: {
          memberAllowList: ["user2", "user3"],
          channelAllowList: ["channel2"],
          requireMentionInGuild: false,
          adminUsers: ["admin2"],
        },
      },
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result).toEqual({
      memberAllowList: ["user2", "user3"],
      channelAllowList: ["channel2"],
      requireMentionInGuild: false,
      adminUsers: ["admin1", "admin2"], // Merged
    });
  });

  it("should merge global and guild-specific admin users", () => {
    const config: DiscordConfig = {
      token: "test-token",
      adminUsers: ["admin1", "admin2"],
      guilds: {
        guild123: {
          adminUsers: ["admin2", "admin3"], // admin2 is duplicate
        },
      },
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result.adminUsers).toEqual(["admin1", "admin2", "admin3"]);
  });

  it("should fall back to global defaults for missing guild fields", () => {
    const config: DiscordConfig = {
      token: "test-token",
      memberAllowList: ["user1"],
      channelAllowList: ["channel1"],
      requireMentionInGuild: false,
      adminUsers: ["admin1"],
      guilds: {
        guild123: {
          // Only override channelAllowList
          channelAllowList: ["channel2"],
        },
      },
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result).toEqual({
      memberAllowList: ["user1"], // Falls back to global
      channelAllowList: ["channel2"], // Guild override
      requireMentionInGuild: false, // Falls back to global
      adminUsers: ["admin1"], // Falls back to global (guild has no adminUsers)
    });
  });

  it("should default requireMentionInGuild to true when not set", () => {
    const config: DiscordConfig = {
      token: "test-token",
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result.requireMentionInGuild).toBe(true);
  });

  it("should handle empty adminUsers arrays", () => {
    const config: DiscordConfig = {
      token: "test-token",
      adminUsers: [],
      guilds: {
        guild123: {
          adminUsers: [],
        },
      },
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result.adminUsers).toEqual([]);
  });

  it("should handle undefined adminUsers", () => {
    const config: DiscordConfig = {
      token: "test-token",
      guilds: {
        guild123: {},
      },
    };

    const result = resolveGuildConfig(config, "guild123");

    expect(result.adminUsers).toEqual([]);
  });
});
