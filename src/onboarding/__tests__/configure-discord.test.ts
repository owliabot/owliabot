/**
 * Unit tests for configureDiscordConfig step function.
 *
 * configureDiscordConfig prompts for Discord bot token, application ID,
 * and optional guild-specific settings when Discord is the chosen channel.
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

describe("configureDiscordConfig step", () => {
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

  it.skip("requires export after refactor — configures discord with token and app id", async () => {
    // answers = ["discord-bot-token-123", "app-id-456"];
    // const config: any = { channels: {} };
    // const secrets: Record<string, any> = {};
    // await configureDiscordConfig(rl, config, secrets);
    // expect(config.channels.discord).toBeDefined();
    // expect(secrets.discord?.token).toBe("discord-bot-token-123");
    // expect(config.channels.discord.applicationId).toBe("app-id-456");
  });

  it.skip("requires export after refactor — uses existing token from secrets when available", async () => {
    // const secrets = { discord: { token: "existing-tok" } };
    // answers = ["", "app-id"];  // empty token = keep existing
    // const config: any = { channels: {} };
    // await configureDiscordConfig(rl, config, secrets);
    // expect(secrets.discord.token).toBe("existing-tok");
  });

  it.skip("requires export after refactor — handles empty app id gracefully", async () => {
    // answers = ["tok-123", ""];
    // const config: any = { channels: {} };
    // const secrets: Record<string, any> = {};
    // await configureDiscordConfig(rl, config, secrets);
    // expect(config.channels.discord).toBeDefined();
    // expect(config.channels.discord.applicationId).toBeUndefined();
  });

  it.skip("requires export after refactor — sets up guild-specific config when guild ID provided", async () => {
    // answers = ["tok", "app-id", "guild-123"];
    // const config: any = { channels: {} };
    // await configureDiscordConfig(rl, config, {});
    // expect(config.channels.discord.guildId).toBe("guild-123");
  });
});
