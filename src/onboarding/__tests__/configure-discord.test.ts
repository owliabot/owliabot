/**
 * Unit tests for configureDiscordConfig step function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({
  startOAuthFlow: vi.fn().mockResolvedValue({}),
}));

vi.mock("../steps/clawlet-setup.js", () => ({
  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

import { configureDiscordConfig } from "../steps/configure-discord.js";

describe("configureDiscordConfig step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let rl: ReturnType<typeof createInterface>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("sets requireMentionInGuild to true with empty allowlists", async () => {
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureDiscordConfig(rl, config, userAllowLists);
    expect(config.discord).toBeDefined();
    expect(config.discord.requireMentionInGuild).toBe(true);
    expect(config.discord.channelAllowList).toEqual([]);
    expect(config.discord.memberAllowList).toBeUndefined();
    expect(userAllowLists.discord).toEqual([]);
  });

  it("does not prompt the user", async () => {
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureDiscordConfig(rl, config, userAllowLists);
    expect(rl.question).not.toHaveBeenCalled();
  });
});
