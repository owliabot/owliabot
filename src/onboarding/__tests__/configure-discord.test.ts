/**
 * Unit tests for configureDiscordConfig step function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";

let answers: string[] = [];
let promptLog: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      promptLog.push(q);
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
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
    answers = [];
    promptLog = [];
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("configures discord with channel and member allowlists", async () => {
    answers = ["chan1,chan2", "user1,user2"];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureDiscordConfig(rl, config, userAllowLists);
    expect(config.discord).toBeDefined();
    expect(config.discord.channelAllowList).toEqual(["chan1", "chan2"]);
    expect(config.discord.memberAllowList).toEqual(["user1", "user2"]);
    expect(userAllowLists.discord).toEqual(["user1", "user2"]);
  });

  it("sets requireMentionInGuild to true", async () => {
    answers = ["", ""];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureDiscordConfig(rl, config, userAllowLists);
    expect(config.discord.requireMentionInGuild).toBe(true);
  });

  it("handles empty allowlists", async () => {
    answers = ["", ""];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureDiscordConfig(rl, config, userAllowLists);
    expect(config.discord).toBeDefined();
    expect(config.discord.channelAllowList).toEqual([]);
    expect(config.discord.memberAllowList).toBeUndefined();
  });

  it("trims whitespace from IDs", async () => {
    answers = [" chan1 , chan2 ", " user1 "];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureDiscordConfig(rl, config, userAllowLists);
    expect(config.discord.channelAllowList).toEqual(["chan1", "chan2"]);
    expect(userAllowLists.discord).toEqual(["user1"]);
  });
});
