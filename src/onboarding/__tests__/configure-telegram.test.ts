/**
 * Unit tests for configureTelegramConfig step function.
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

  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

import { configureTelegramConfig } from "../steps/configure-telegram.js";

describe("configureTelegramConfig step", () => {
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

  it("configures telegram with user allowlist", async () => {
    answers = ["user1,user2"];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureTelegramConfig(rl, config, userAllowLists);
    expect(config.telegram).toBeDefined();
    expect(userAllowLists.telegram).toEqual(["user1", "user2"]);
  });

  it("sets allowList on config when user IDs provided", async () => {
    answers = ["111,222,333"];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureTelegramConfig(rl, config, userAllowLists);
    expect(config.telegram.allowList).toEqual(["111", "222", "333"]);
  });

  it("handles empty user allowlist", async () => {
    answers = [""];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureTelegramConfig(rl, config, userAllowLists);
    expect(config.telegram).toBeDefined();
    expect(config.telegram.allowList).toBeUndefined();
    expect(userAllowLists.telegram).toEqual([]);
  });

  it("trims whitespace from user IDs", async () => {
    answers = [" user1 , user2 "];
    const config: any = {};
    const userAllowLists: any = { discord: [], telegram: [] };
    await configureTelegramConfig(rl, config, userAllowLists);
    expect(userAllowLists.telegram).toEqual(["user1", "user2"]);
  });
});
