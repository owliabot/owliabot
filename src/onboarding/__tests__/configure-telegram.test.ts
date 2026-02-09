/**
 * Unit tests for configureTelegramConfig step function.
 *
 * configureTelegramConfig prompts for Telegram bot token and optional
 * allowed chat IDs when Telegram is the chosen channel.
 *
 * NOT exported yet — tests are skipped until the refactor exports this function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

describe("configureTelegramConfig step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    promptLog = [];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it.skip("requires export after refactor — configures telegram with bot token", async () => {
    // answers = ["123456:ABC-DEF"];
    // const config: any = { channels: {} };
    // const secrets: Record<string, any> = {};
    // await configureTelegramConfig(rl, config, secrets);
    // expect(config.channels.telegram).toBeDefined();
    // expect(secrets.telegram?.token).toBe("123456:ABC-DEF");
  });

  it.skip("requires export after refactor — configures allowed chat IDs when provided", async () => {
    // answers = ["tok-123", "111,222,333"];
    // const config: any = { channels: {} };
    // await configureTelegramConfig(rl, config, {});
    // expect(config.channels.telegram.allowedChatIds).toEqual(["111", "222", "333"]);
  });

  it.skip("requires export after refactor — skips allowed chat IDs when empty", async () => {
    // answers = ["tok-123", ""];
    // const config: any = { channels: {} };
    // await configureTelegramConfig(rl, config, {});
    // expect(config.channels.telegram.allowedChatIds).toBeUndefined();
  });

  it.skip("requires export after refactor — uses existing token from secrets", async () => {
    // const secrets = { telegram: { token: "existing" } };
    // answers = [""];  // empty = keep existing
    // const config: any = { channels: {} };
    // await configureTelegramConfig(rl, config, secrets);
    // expect(secrets.telegram.token).toBe("existing");
  });
});
