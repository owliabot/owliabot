import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runOnboarding } from "../onboard.js";
import { loadAppConfig } from "../storage.js";
import { loadSecrets } from "../secrets.js";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let answers: string[] = [];
let promptLog: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      promptLog.push(q);
      const next = answers.shift();
      if (next === undefined) {
        console.error("Ran out of answers! Prompts so far:", promptLog);
        throw new Error(`Ran out of answers at prompt: "${q}"`);
      }
      cb(next);
    },
    close: () => {},
  }),
}));

vi.mock("../../auth/oauth.js", () => ({
  startOAuthFlow: vi.fn().mockResolvedValue({
    access: "test_access",
    refresh: "test_refresh",
    expires: Date.now() + 3600000,
  }),
}));

// Mock clawlet onboarding to skip wallet prompts (no daemon in test)
vi.mock("../clawlet-onboard.js", () => ({
  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

describe("onboarding", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-onboard-"));
  });

  afterEach(async () => {
    answers = [];
    promptLog = [];
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  // Unified flow order: providers → channels → timezone → config details

  it("writes config with anthropic setup-token and separates secrets", async () => {
    const appConfigPath = join(dir, "app.yaml");

    // Create a valid setup-token (sk-ant-oat01- prefix + enough chars for 80 total)
    const setupToken = "sk-ant-oat01-" + "a".repeat(68); // 12 + 68 = 80 chars

    answers = [
      "1",                 // AI provider: 1 = Anthropic
      setupToken,          // Anthropic setup-token
      "",                  // Model (default: claude-opus-4-5)
      "3",                 // Chat platform: 3 = Both (Discord + Telegram)
      "discord-secret",    // Discord token
      "telegram-secret",   // Telegram token
      "America/New_York",  // Timezone
      "111,222",           // Discord channelAllowList
      "123456789",         // Discord memberAllowList
      "539066683",         // Telegram allowList
      // Note: Clawlet onboarding is skipped (no daemon in test environment)
      "",                  // writeToolAllowList (use default from channels)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);
    const secrets = await loadSecrets(appConfigPath);

    expect(config?.workspace).toBe("workspace");
    expect(config?.memorySearch?.store?.path).toBe("{workspace}/memory/{agentId}.sqlite");
    expect(config?.timezone).toBe("America/New_York");
    expect(config?.providers?.[0]?.id).toBe("anthropic");
    expect(config?.providers?.[0]?.apiKey).toBe("secrets");
    expect(config?.providers?.[0]?.model).toBe("claude-opus-4-5");
    expect(config?.gateway?.http).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      token: "secrets",
    });
    expect(config?.discord?.requireMentionInGuild).toBe(true);
    expect(config?.discord?.channelAllowList).toEqual(["111", "222"]);
    expect(config?.discord?.memberAllowList).toEqual(["123456789"]);
    expect(config?.discord && "token" in config.discord).toBe(false);
    expect(config?.telegram?.allowList).toEqual(["539066683"]);
    expect(config?.telegram && "token" in config.telegram).toBe(false);
    expect(config?.tools?.allowWrite).toBe(true);
    expect(config?.security?.writeToolAllowList).toEqual(["123456789", "539066683"]);
    expect(config?.security?.writeGateEnabled).toBe(false);
    expect(config?.security?.writeToolConfirmation).toBe(false);

    expect(secrets?.discord?.token).toBe("discord-secret");
    expect(secrets?.telegram?.token).toBe("telegram-secret");
    expect(secrets?.anthropic?.token).toBe(setupToken);
    expect(secrets?.gateway?.token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("writes config with openai api key", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "2",                 // AI provider: 2 = OpenAI
      "sk-test-key",       // OpenAI API key
      "gpt-4o-mini",       // Model
      "1",                 // Chat platform: 1 = Discord
      "",                  // Discord token (skip)
      "UTC",               // Timezone
      "",                  // Discord channelAllowList (empty)
      "",                  // Discord memberAllowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);
    const secrets = await loadSecrets(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("openai");
    expect(config?.providers?.[0]?.model).toBe("gpt-4o-mini");
    expect(config?.providers?.[0]?.apiKey).toBe("secrets");

    expect(secrets?.openai?.apiKey).toBe("sk-test-key");
  });

  it("writes config with openai-codex oauth", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "3",                 // AI provider: 3 = openai-codex
      "n",                 // Skip OAuth for now
      "1",                 // Chat platform: 1 = Discord
      "",                  // Discord token (skip)
      "UTC",               // Timezone
      "",                  // Discord channelAllowList (empty)
      "",                  // Discord memberAllowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("openai-codex");
    expect(config?.providers?.[0]?.model).toBe("gpt-5.2");
    expect(config?.providers?.[0]?.apiKey).toBe("oauth");
  });

  it("writes config with anthropic standard api key", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "1",                 // AI provider: 1 = Anthropic
      "sk-ant-api03-test-key",  // Anthropic standard API key
      "",                  // Model (default)
      "1",                 // Chat platform: 1 = Discord
      "",                  // Discord token (skip)
      "UTC",               // Timezone
      "",                  // Discord channelAllowList (empty)
      "",                  // Discord memberAllowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);
    const secrets = await loadSecrets(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("anthropic");
    expect(config?.providers?.[0]?.apiKey).toBe("secrets");

    // Standard API key should be stored in apiKey field, not token
    expect(secrets?.anthropic?.apiKey).toBe("sk-ant-api03-test-key");
    expect(secrets?.anthropic?.token).toBeUndefined();
  });

  it("supports env-based api key for anthropic", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "1",                 // AI provider: 1 = Anthropic
      "",                  // API key (empty = use env var)
      "",                  // Model (default)
      "1",                 // Chat platform: 1 = Discord
      "",                  // Discord token (skip)
      "UTC",               // Timezone
      "",                  // Discord channelAllowList (empty)
      "",                  // Discord memberAllowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("anthropic");
    expect(config?.providers?.[0]?.apiKey).toBe("env");
  });

  it("supports env-based api key for openai", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "2",                 // AI provider: 2 = OpenAI
      "",                  // OpenAI API key (empty = use env)
      "",                  // Model (default)
      "2",                 // Chat platform: 2 = Telegram
      "",                  // Telegram token (skip)
      "UTC",               // Timezone
      "",                  // Telegram allowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("openai");
    expect(config?.providers?.[0]?.model).toBe("gpt-5.2");
    expect(config?.providers?.[0]?.apiKey).toBe("env");
  });

  it("stores workspace as a relative path and initializes it next to app.yaml", async () => {
    const appConfigPath = join(dir, "app.yaml");
    const expectedWorkspaceDir = join(dir, "workspace");

    answers = [
      "1",                 // AI provider: 1 = Anthropic
      "",                  // API key (env)
      "",                  // Model (default)
      "1",                 // Chat platform: 1 = Discord
      "",                  // Discord token (skip)
      "UTC",               // Timezone
      "",                  // Discord channelAllowList (empty)
      "",                  // Discord memberAllowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);
    expect(config?.workspace).toBe("workspace");
    expect(existsSync(expectedWorkspaceDir)).toBe(true);
  });

  it("uses default allowlists for both platforms", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "1",                 // AI provider: 1 = Anthropic
      "",                  // API key (env)
      "",                  // Model (default)
      "3",                 // Chat platform: 3 = Both
      "",                  // Discord token (skip)
      "",                  // Telegram token (skip)
      "UTC",               // Timezone
      "",                  // Discord channelAllowList (empty)
      "",                  // Discord memberAllowList (empty)
      "",                  // Telegram allowList (empty)
      // Note: Clawlet onboarding skipped (no daemon in test)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    // New simplified flow uses defaults
    expect(config?.discord?.requireMentionInGuild).toBe(true);
    expect(config?.discord?.channelAllowList).toEqual([]);
    expect(config?.discord?.memberAllowList).toBeUndefined();
    expect(config?.telegram?.allowList).toBeUndefined();
  });
});
