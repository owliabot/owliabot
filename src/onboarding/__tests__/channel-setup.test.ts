/**
 * Unit tests for channel-setup step functions:
 * - askChannels
 * - getChannelsSetup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DetectedConfig } from "../steps/types.js";

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

vi.mock("../clawlet-onboard.js", () => ({
  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

import { createInterface } from "node:readline";
import { askChannels, getChannelsSetup } from "../steps/channel-setup.js";

describe("channel-setup step", () => {
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

  // ── askChannels ─────────────────────────────────────────────────────────

  describe("askChannels", () => {
    it("selects Discord only (choice 1)", async () => {
      answers = ["1", "discord-token-123"];
      const secrets: any = {};
      const result = await askChannels(rl, secrets);
      expect(result.discordEnabled).toBe(true);
      expect(result.telegramEnabled).toBe(false);
      expect(result.discordToken).toBe("discord-token-123");
      expect(secrets.discord?.token).toBe("discord-token-123");
    });

    it("selects Telegram only (choice 2)", async () => {
      answers = ["2", "tg-token-456"];
      const secrets: any = {};
      const result = await askChannels(rl, secrets);
      expect(result.discordEnabled).toBe(false);
      expect(result.telegramEnabled).toBe(true);
      expect(result.telegramToken).toBe("tg-token-456");
    });

    it("selects Both (choice 3)", async () => {
      answers = ["3", "d-tok", "t-tok"];
      const secrets: any = {};
      const result = await askChannels(rl, secrets);
      expect(result.discordEnabled).toBe(true);
      expect(result.telegramEnabled).toBe(true);
      expect(result.discordToken).toBe("d-tok");
      expect(result.telegramToken).toBe("t-tok");
    });

    it("skips token when empty", async () => {
      answers = ["1", ""];
      const secrets: any = {};
      const result = await askChannels(rl, secrets);
      expect(result.discordEnabled).toBe(true);
      expect(result.discordToken).toBe("");
      expect(secrets.discord).toBeUndefined();
    });
  });

  // ── getChannelsSetup ───────────────────────────────────────────────────

  describe("getChannelsSetup", () => {
    it("reuses existing discord token", async () => {
      const existing: DetectedConfig = { discordToken: "existing-d-tok" };
      const secrets: any = {};
      const result = await getChannelsSetup(rl, false, secrets, existing, true);
      expect(result.discordEnabled).toBe(true);
      expect(result.discordToken).toBe("existing-d-tok");
      expect(secrets.discord?.token).toBe("existing-d-tok");
    });

    it("reuses existing telegram token", async () => {
      const existing: DetectedConfig = { telegramToken: "existing-t-tok" };
      const secrets: any = {};
      const result = await getChannelsSetup(rl, false, secrets, existing, true);
      expect(result.telegramEnabled).toBe(true);
    });

    it("reuses both when both exist", async () => {
      const existing: DetectedConfig = { discordToken: "d", telegramToken: "t" };
      const result = await getChannelsSetup(rl, false, {}, existing, true);
      expect(result.discordEnabled).toBe(true);
      expect(result.telegramEnabled).toBe(true);
    });

    it("falls through to askChannels when reuseExisting=false", async () => {
      const existing: DetectedConfig = { discordToken: "d" };
      answers = ["2", "new-tg-tok"];
      const result = await getChannelsSetup(rl, false, {}, existing, false);
      expect(result.telegramEnabled).toBe(true);
      expect(result.telegramToken).toBe("new-tg-tok");
    });

    it("falls through when existing has no channel tokens", async () => {
      const existing: DetectedConfig = { anthropicKey: "k" };
      answers = ["1", ""];
      const result = await getChannelsSetup(rl, false, {}, existing, true);
      expect(result.discordEnabled).toBe(true);
    });
  });
});
