import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runOnboarding } from "../onboard.js";
import { loadAppConfig } from "../storage.js";
import { loadSecrets } from "../secrets.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let answers: string[] = [];
let promptLog: string[] = [];

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

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

  // Unified flow order: providers → channels → config details (timezone auto-detected)

  it("writes config with anthropic setup-token and separates secrets", async () => {
    const appConfigPath = join(dir, "app.yaml");

    // Make timezone deterministic for this test (onboarding auto-detects via Intl).
    const tzSpy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({
      resolvedOptions: () => ({ timeZone: "America/New_York" }),
    }) as any);

    // Create a valid setup-token (sk-ant-oat01- prefix + enough chars for 80 total)
    const setupToken = "sk-ant-oat01-" + "a".repeat(68); // 12 + 68 = 80 chars

    answers = [
      "1",                 // AI provider: 1 = Anthropic
      setupToken,          // Anthropic setup-token
      "",                  // Model (default: claude-opus-4-5)
      "3",                 // Chat platform: 3 = Both (Discord + Telegram)
      "discord-secret",    // Discord token
      "telegram-secret",   // Telegram token
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

    tzSpy.mockRestore();
  });

  it("prints friendly save messages (not log-style)", async () => {
    const appConfigPath = join(dir, "app.yaml");

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    try {
      answers = [
        "1", // AI provider: 1 = Anthropic
        "",  // Anthropic key/token (empty = env)
        "",  // Model (default)
        "1", // Chat platform: 1 = Discord
        "",  // Discord token (skip)
        "",  // Discord channelAllowList (empty)
        "",  // Discord memberAllowList (empty)
        // Note: Clawlet onboarding skipped (no daemon in test)
      ];

      await runOnboarding({ appConfigPath });
    } finally {
      logSpy.mockRestore();
    }

    const out = stripAnsi(logs.join("\n"));
    expect(out).toContain("Saved your settings in ");
    expect(out).toContain("Saved your tokens and keys in ");
    expect(out).toContain("Added BOOTSTRAP.md");
    expect(out).toContain("Built-in skills are ready in ");
    expect(out).not.toContain("Saved settings to:");
    expect(out).not.toContain("Saved sensitive values to:");
    expect(out).not.toContain("Created BOOTSTRAP.md");
    expect(out).not.toContain("Copied built-in skills to:");
  });

  it("writes config with openai api key", async () => {
    const appConfigPath = join(dir, "app.yaml");

    answers = [
      "2",                 // AI provider: 2 = OpenAI
      "sk-test-key",       // OpenAI API key
      "gpt-4o-mini",       // Model
      "1",                 // Chat platform: 1 = Discord
      "",                  // Discord token (skip)
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

  it("prompts to reuse existing Telegram config and preserves allowList/groups when reused", async () => {
    const appConfigPath = join(dir, "app.yaml");

    // Isolate OWLIABOT_HOME so any local OAuth files don't affect this test.
    const oldHome = process.env.OWLIABOT_HOME;
    process.env.OWLIABOT_HOME = join(dir, ".owliabot-home");
    try {
      // Seed existing app.yaml + secrets.yaml with Telegram settings.
      await writeFile(
        appConfigPath,
        [
          "telegram:",
          "  allowList:",
          '    - "539066683"',
          "  groups:",
          '    "*":',
          "      requireMention: true",
          '    "-100123":',
          "      requireMention: false",
          "      historyLimit: 200",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        join(dir, "secrets.yaml"),
        ["telegram:", '  token: "existing-token"', ""].join("\n"),
        "utf-8",
      );

      answers = [
        "n",         // Want to keep using these settings? -> no (test Telegram-specific reuse)
        "1",         // AI provider: 1 = Anthropic
        "",          // Anthropic key/token (empty = env)
        "",          // Model (default)
        "2",         // Chat platform: 2 = Telegram
        "y",         // Reuse existing Telegram config?
        "539066683", // write-tools extra IDs (harmless duplicate)
        "",          // write-tools extra IDs (empty)
      ];

      await runOnboarding({ appConfigPath });

      const config = await loadAppConfig(appConfigPath);
      const secrets = await loadSecrets(appConfigPath);

      // New behavior: explicit reuse prompt, and Telegram prompts are skipped when reused.
      const prompts = promptLog.join("\n");
      expect(prompts).toContain("Reuse your existing Telegram setup");
      expect(prompts).not.toContain("Telegram bot token");

      // Reused from existing app.yaml
      expect(config?.telegram?.allowList).toEqual(["539066683"]);
      expect(config?.telegram?.groups).toEqual({
        "*": { requireMention: true },
        "-100123": { requireMention: false, historyLimit: 200 },
      });

      // Reused from existing secrets.yaml
      expect(secrets?.telegram?.token).toBe("existing-token");
    } finally {
      if (oldHome === undefined) delete process.env.OWLIABOT_HOME;
      else process.env.OWLIABOT_HOME = oldHome;
    }
  });

  it("keeps onboarding copy conversational (no internal jargon)", async () => {
    const appConfigPath = join(dir, "app.yaml");

    // Isolate OWLIABOT_HOME so any local OAuth files don't affect this test.
    const oldHome = process.env.OWLIABOT_HOME;
    process.env.OWLIABOT_HOME = join(dir, ".owliabot-home");

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    try {
      // Seed existing app.yaml + secrets.yaml with Telegram settings.
      await writeFile(
        appConfigPath,
        [
          "telegram:",
          "  allowList:",
          '    - "539066683"',
          "  groups:",
          '    "*":',
          "      requireMention: true",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        join(dir, "secrets.yaml"),
        ["telegram:", '  token: "existing-token"', ""].join("\n"),
        "utf-8",
      );

      answers = [
        "n", // Want to keep using these settings? -> no (exercise Telegram-specific reuse prompt)
        "1", // AI provider: 1 = Anthropic
        "",  // Anthropic key/token (empty = env)
        "",  // Model (default)
        "2", // Chat platform: 2 = Telegram
        "y", // Reuse existing Telegram setup?
        "",  // write-tools extra IDs (empty)
      ];

      await runOnboarding({ appConfigPath });
    } finally {
      logSpy.mockRestore();
      if (oldHome === undefined) delete process.env.OWLIABOT_HOME;
      else process.env.OWLIABOT_HOME = oldHome;
    }

    const out = stripAnsi(logs.join("\n"));
    expect(out).toContain("allowed users:");
    expect(out).toContain("File editing");
    expect(out).not.toContain("allowList:");
    expect(out).not.toContain("allowlisted");
    expect(out).not.toContain("apply_patch");
  });

  it("does not treat an env-placeholder Telegram token in app.yaml as a reusable secret", async () => {
    const appConfigPath = join(dir, "app.yaml");

    // Isolate OWLIABOT_HOME so any local OAuth files don't affect this test.
    const oldHome = process.env.OWLIABOT_HOME;
    process.env.OWLIABOT_HOME = join(dir, ".owliabot-home");

    try {
      // Seed existing app.yaml with Telegram settings and an env placeholder token.
      // This should NOT be copied into secrets.yaml when reusing.
      await writeFile(
        appConfigPath,
        [
          "telegram:",
          '  token: "${TELEGRAM_BOT_TOKEN}"',
          "  allowList:",
          '    - "539066683"',
          "  groups:",
          '    "*":',
          "      requireMention: true",
          "",
        ].join("\n"),
        "utf-8",
      );

      answers = [
        "n", // Want to keep using these settings? -> no (test Telegram-specific reuse)
        "1", // AI provider: 1 = Anthropic
        "",  // Anthropic key/token (empty = env)
        "",  // Model (default)
        "2", // Chat platform: 2 = Telegram
        "y", // Reuse existing Telegram config?
        "",  // Telegram bot token (leave empty to keep env-based setup)
        "",  // write-tools extra IDs (empty)
      ];

      await runOnboarding({ appConfigPath });

      const secrets = await loadSecrets(appConfigPath);

      const prompts = promptLog.join("\n");
      expect(prompts).toContain("Reuse your existing Telegram setup");
      // Since the token in app.yaml is just an env placeholder, we should still prompt for a real token.
      expect(prompts).toContain("Telegram bot token");
      expect(secrets?.telegram?.token).toBeUndefined();
    } finally {
      if (oldHome === undefined) delete process.env.OWLIABOT_HOME;
      else process.env.OWLIABOT_HOME = oldHome;
    }
  });

  it("in docker mode, still asks whether to reuse existing Telegram configuration when reusing existing settings", async () => {
    const oldHomeEnv = process.env.HOME;
    const oldOwliabotHome = process.env.OWLIABOT_HOME;
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    // Docker mode always anchors config at $HOME/.owliabot; isolate it per-test.
    process.env.HOME = dir;
    process.env.OWLIABOT_HOME = join(dir, ".owliabot");

    try {
      const dockerConfigDir = join(dir, ".owliabot");
      const dockerAppConfigPath = join(dockerConfigDir, "app.yaml");
      await mkdir(dockerConfigDir, { recursive: true });

      await writeFile(
        dockerAppConfigPath,
        [
          "telegram: {}",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        join(dockerConfigDir, "secrets.yaml"),
        ["telegram:", '  token: "existing-token"', ""].join("\n"),
        "utf-8",
      );

      answers = [
        "y", // "Want to keep using these settings?" -> yes
        "1", // "Which AI should OwliaBot use?" -> 1 (Anthropic)
        "",  // "Anthropic setup-token / API key" -> empty (use env)
        "",  // "Which model should I use?" -> default
        "",  // "Reuse existing Telegram configuration (token + allowList/groups)?" -> default yes
        "",  // "Which port should I use on your machine for Gateway HTTP?" -> default
        "",  // "Extra allowlisted user IDs for write/edit tools?" -> none
      ];

      await runOnboarding({ docker: true, outputDir: dir });

      const prompts = promptLog.join("\n");
      expect(prompts).toContain("Reuse your existing Telegram setup");

      const out = stripAnsi(logs.join("\n"));
      expect(out).toContain("token only");
      expect(out).not.toContain("allowList");
      expect(out).toContain("Saved docker-compose.yml in ");
      expect(out).not.toContain("Created ");
    } finally {
      logSpy.mockRestore();
      if (oldHomeEnv === undefined) delete process.env.HOME;
      else process.env.HOME = oldHomeEnv;
      if (oldOwliabotHome === undefined) delete process.env.OWLIABOT_HOME;
      else process.env.OWLIABOT_HOME = oldOwliabotHome;
    }
  });
});
