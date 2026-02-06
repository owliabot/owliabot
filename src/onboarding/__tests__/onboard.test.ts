import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runOnboarding } from "../onboard.js";
import { loadAppConfig } from "../storage.js";
import { loadSecrets } from "../secrets.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let answers: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (ans: string) => void) => {
      const next = answers.shift() ?? "";
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

describe("onboarding", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owliabot-onboard-"));
  });

  afterEach(async () => {
    answers = [];
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("writes config with anthropic api key (OAuth removed)", async () => {
    const appConfigPath = join(dir, "app.yaml");
    const workspacePath = join(dir, "workspace");

    // Anthropic now only supports API key (no OAuth prompt)
    answers = [
      "discord,telegram", // channels
      workspacePath,       // workspace
      "anthropic",         // provider
      "",                  // model (default)
      "sk-ant-test-key",   // Anthropic API key (directly asked now)
      "y",                 // require mention
      "111,222",           // channel allowlist
      "discord-secret",    // discord token
      "telegram-secret",   // telegram token
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);
    const secrets = await loadSecrets(appConfigPath);

    expect(config?.workspace).toBe(workspacePath);
    expect(config?.providers?.[0]?.id).toBe("anthropic");
    expect(config?.providers?.[0]?.apiKey).toBe("secrets");
    expect(config?.providers?.[0]?.model).toBe("claude-sonnet-4-5");
    expect(config?.discord?.requireMentionInGuild).toBe(true);
    expect(config?.discord?.channelAllowList).toEqual(["111", "222"]);
    expect(config?.discord && "token" in config.discord).toBe(false);
    expect(config?.telegram && "token" in config.telegram).toBe(false);

    expect(secrets?.discord?.token).toBe("discord-secret");
    expect(secrets?.telegram?.token).toBe("telegram-secret");
    expect(secrets?.anthropic?.apiKey).toBe("sk-ant-test-key");
  });

  it("writes config with anthropic env-based api key", async () => {
    const appConfigPath = join(dir, "app.yaml");
    const workspacePath = join(dir, "workspace");

    // Empty API key means use env var
    answers = [
      "discord",           // channels
      workspacePath,       // workspace
      "anthropic",         // provider
      "",                  // model (default)
      "",                  // Anthropic API key (empty = use env)
      "y",                 // require mention
      "",                  // channel allowlist (default)
      "",                  // discord token (skip)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("anthropic");
    expect(config?.providers?.[0]?.apiKey).toBe("env");
  });

  it("writes config with openai api key", async () => {
    const appConfigPath = join(dir, "app.yaml");
    const workspacePath = join(dir, "workspace");

    answers = [
      "discord",           // channels
      workspacePath,       // workspace
      "openai",            // provider
      "gpt-4o-mini",       // model
      "sk-test-key",       // OpenAI API key
      "y",                 // require mention
      "",                  // channel allowlist (default)
      "",                  // discord token (skip)
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
    const workspacePath = join(dir, "workspace");

    answers = [
      "discord",           // channels
      workspacePath,       // workspace
      "openai-codex",      // provider
      "",                  // model (default)
      "n",                 // skip OAuth for now
      "y",                 // require mention
      "",                  // channel allowlist (default)
      "",                  // discord token (skip)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("openai-codex");
    expect(config?.providers?.[0]?.model).toBe("gpt-5.2");
    expect(config?.providers?.[0]?.apiKey).toBe("oauth");
  });

  it("supports env-based api key for openai", async () => {
    const appConfigPath = join(dir, "app.yaml");
    const workspacePath = join(dir, "workspace");

    answers = [
      "discord",           // channels
      workspacePath,       // workspace
      "openai",            // provider
      "",                  // model (default)
      "",                  // OpenAI API key (empty = use env)
      "y",                 // require mention
      "",                  // channel allowlist (default)
      "",                  // discord token (skip)
    ];

    await runOnboarding({ appConfigPath });

    const config = await loadAppConfig(appConfigPath);

    expect(config?.providers?.[0]?.id).toBe("openai");
    expect(config?.providers?.[0]?.apiKey).toBe("env");
  });
});
