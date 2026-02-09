import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mergeDiscordConfig } from "../merge.js";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { tmpdir } from "node:os";

describe("mergeDiscordConfig", () => {
  let testConfigPath: string;

  beforeEach(async () => {
    // Create a temporary config file for each test
    testConfigPath = join(tmpdir(), `test-config-${Date.now()}.yaml`);
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await unlink(testConfigPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("should update discord section only", async () => {
    // Create initial config
    const initialConfig = {
      workspace: "./workspace",
      providers: [
        { id: "anthropic", model: "claude-opus-4-5", apiKey: "env", priority: 1 },
      ],
      telegram: {
        allowList: ["user1"],
      },
    };

    await writeFile(testConfigPath, JSON.stringify(initialConfig), "utf-8");

    // Merge discord config
    await mergeDiscordConfig(testConfigPath, {
      requireMentionInGuild: true,
      channelAllowList: ["channel1", "channel2"],
      memberAllowList: ["user1"],
    });

    // Read back and verify
    const result = parse(await readFile(testConfigPath, "utf-8"));

    expect(result.workspace).toBe("./workspace");
    expect(result.providers).toEqual(initialConfig.providers);
    expect(result.telegram).toEqual(initialConfig.telegram);
    expect(result.discord).toEqual({
      requireMentionInGuild: true,
      channelAllowList: ["channel1", "channel2"],
      memberAllowList: ["user1"],
    });
  });

  it("should create discord section if missing", async () => {
    const initialConfig = {
      workspace: "./workspace",
      providers: [
        { id: "anthropic", model: "claude-opus-4-5", apiKey: "env", priority: 1 },
      ],
    };

    await writeFile(testConfigPath, JSON.stringify(initialConfig), "utf-8");

    await mergeDiscordConfig(testConfigPath, {
      requireMentionInGuild: false,
      adminUsers: ["admin1"],
    });

    const result = parse(await readFile(testConfigPath, "utf-8"));

    expect(result.discord).toEqual({
      requireMentionInGuild: false,
      adminUsers: ["admin1"],
    });
  });

  it("should merge with existing discord section", async () => {
    const initialConfig = {
      workspace: "./workspace",
      discord: {
        requireMentionInGuild: true,
        channelAllowList: ["channel1"],
      },
    };

    await writeFile(testConfigPath, JSON.stringify(initialConfig), "utf-8");

    await mergeDiscordConfig(testConfigPath, {
      channelAllowList: ["channel2", "channel3"],
      memberAllowList: ["user1"],
    });

    const result = parse(await readFile(testConfigPath, "utf-8"));

    expect(result.discord).toEqual({
      requireMentionInGuild: true, // Preserved from original
      channelAllowList: ["channel2", "channel3"], // Replaced
      memberAllowList: ["user1"], // Added
    });
  });

  it("should handle per-guild config", async () => {
    const initialConfig = {
      workspace: "./workspace",
      discord: {
        requireMentionInGuild: true,
      },
    };

    await writeFile(testConfigPath, JSON.stringify(initialConfig), "utf-8");

    await mergeDiscordConfig(testConfigPath, {
      guilds: {
        guild123: {
          channelAllowList: ["channel1"],
          requireMentionInGuild: false,
        },
        guild456: {
          memberAllowList: ["user1", "user2"],
        },
      },
    });

    const result = parse(await readFile(testConfigPath, "utf-8"));

    expect(result.discord.guilds).toEqual({
      guild123: {
        channelAllowList: ["channel1"],
        requireMentionInGuild: false,
      },
      guild456: {
        memberAllowList: ["user1", "user2"],
      },
    });
  });

  it("should preserve other config sections", async () => {
    const initialConfig = {
      workspace: "./workspace",
      providers: [
        { id: "anthropic", model: "claude-opus-4-5", apiKey: "env", priority: 1 },
      ],
      telegram: {
        allowList: ["user1"],
      },
      notifications: {
        channel: "telegram:123",
      },
      security: {
        writeGateEnabled: false,
      },
    };

    await writeFile(testConfigPath, JSON.stringify(initialConfig), "utf-8");

    await mergeDiscordConfig(testConfigPath, {
      requireMentionInGuild: true,
    });

    const result = parse(await readFile(testConfigPath, "utf-8"));

    expect(result.workspace).toBe(initialConfig.workspace);
    expect(result.providers).toEqual(initialConfig.providers);
    expect(result.telegram).toEqual(initialConfig.telegram);
    expect(result.notifications).toEqual(initialConfig.notifications);
    expect(result.security).toEqual(initialConfig.security);
    expect(result.discord).toEqual({ requireMentionInGuild: true });
  });

  it("should overwrite discord fields on subsequent merges", async () => {
    const initialConfig = {
      workspace: "./workspace",
      discord: {
        requireMentionInGuild: false,
        channelAllowList: ["channel1"],
        memberAllowList: ["user1"],
      },
    };

    await writeFile(testConfigPath, JSON.stringify(initialConfig), "utf-8");

    // First merge
    await mergeDiscordConfig(testConfigPath, {
      channelAllowList: ["channel2"],
    });

    let result = parse(await readFile(testConfigPath, "utf-8"));
    expect(result.discord.channelAllowList).toEqual(["channel2"]);
    expect(result.discord.requireMentionInGuild).toBe(false); // Still preserved

    // Second merge
    await mergeDiscordConfig(testConfigPath, {
      requireMentionInGuild: true,
      adminUsers: ["admin1"],
    });

    result = parse(await readFile(testConfigPath, "utf-8"));
    expect(result.discord).toEqual({
      requireMentionInGuild: true,
      channelAllowList: ["channel2"], // Preserved from first merge
      memberAllowList: ["user1"], // Preserved from original
      adminUsers: ["admin1"],
    });
  });
});
