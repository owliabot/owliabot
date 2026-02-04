import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../loader.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

const ENV_SNAPSHOT = { ...process.env };

describe("config loader", () => {
  let dir: string;

  beforeEach(async () => {
    process.env = { ...ENV_SNAPSHOT };
    dir = await mkdtemp(join(tmpdir(), "owliabot-config-"));
  });

  afterEach(async () => {
    process.env = { ...ENV_SNAPSHOT };
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expands env vars and merges secrets", async () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic";
    process.env.TELEGRAM_BOT_TOKEN = "env-telegram";
    process.env.DISCORD_BOT_TOKEN = "env-discord";

    const appConfigPath = join(dir, "app.yaml");
    const secretsPath = join(dir, "secrets.yaml");

    const appConfig = {
      providers: [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "${ANTHROPIC_API_KEY}", priority: 1 },
      ],
      workspace: "./workspace",
      discord: {},
      telegram: {},
    };

    const secrets = {
      discord: { token: "secret-discord" },
    };

    await writeFile(appConfigPath, stringify(appConfig, { indent: 2 }), "utf-8");
    await writeFile(secretsPath, stringify(secrets, { indent: 2 }), "utf-8");

    const config = await loadConfig(appConfigPath);

    expect(config.providers[0]?.apiKey).toBe("env-anthropic");
    expect(config.discord?.token).toBe("secret-discord");
    expect(config.telegram?.token).toBe("env-telegram");
    expect(config.workspace).toBe(join(dir, "workspace"));
  });

  it("throws a clear error when the config file is missing", async () => {
    const missingPath = join(dir, "missing.yaml");
    await expect(loadConfig(missingPath)).rejects.toThrow(
      `Config file not found: ${missingPath}`
    );
  });

  it("formats Zod validation errors clearly", async () => {
    const appConfigPath = join(dir, "bad.yaml");

    const badConfig = {
      providers: [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "k", priority: "high" },
      ],
      workspace: "./workspace",
    };

    await writeFile(appConfigPath, stringify(badConfig, { indent: 2 }), "utf-8");

    await expect(loadConfig(appConfigPath)).rejects.toThrow(
      "Config validation failed:"
    );
    await expect(loadConfig(appConfigPath)).rejects.toThrow(
      "providers.0.priority"
    );
  });

  it("loads provider API keys from secrets when apiKey is 'secrets'", async () => {
    const appConfigPath = join(dir, "app.yaml");
    const secretsPath = join(dir, "secrets.yaml");

    const appConfig = {
      providers: [
        { id: "openai", model: "gpt-4o", apiKey: "secrets", priority: 1 },
      ],
      workspace: "./workspace",
    };

    const secrets = {
      openai: { apiKey: "sk-secret-openai-key" },
    };

    await writeFile(appConfigPath, stringify(appConfig, { indent: 2 }), "utf-8");
    await writeFile(secretsPath, stringify(secrets, { indent: 2 }), "utf-8");

    const config = await loadConfig(appConfigPath);

    expect(config.providers[0]?.apiKey).toBe("sk-secret-openai-key");
  });

  it("loads provider API keys from env when apiKey is 'env'", async () => {
    process.env.OPENAI_API_KEY = "sk-env-openai-key";

    const appConfigPath = join(dir, "app.yaml");

    const appConfig = {
      providers: [
        { id: "openai", model: "gpt-4o", apiKey: "env", priority: 1 },
      ],
      workspace: "./workspace",
    };

    await writeFile(appConfigPath, stringify(appConfig, { indent: 2 }), "utf-8");

    const config = await loadConfig(appConfigPath);

    expect(config.providers[0]?.apiKey).toBe("sk-env-openai-key");
  });

  it("prefers secrets over env for provider API keys when apiKey is 'secrets'", async () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key";

    const appConfigPath = join(dir, "app.yaml");
    const secretsPath = join(dir, "secrets.yaml");

    const appConfig = {
      providers: [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "secrets", priority: 1 },
      ],
      workspace: "./workspace",
    };

    const secrets = {
      anthropic: { apiKey: "secret-anthropic-key" },
    };

    await writeFile(appConfigPath, stringify(appConfig, { indent: 2 }), "utf-8");
    await writeFile(secretsPath, stringify(secrets, { indent: 2 }), "utf-8");

    const config = await loadConfig(appConfigPath);

    expect(config.providers[0]?.apiKey).toBe("secret-anthropic-key");
  });

  it("ignores secrets when apiKey is 'env' (user explicitly chose env-based auth)", async () => {
    process.env.OPENAI_API_KEY = "sk-env-openai-key";

    const appConfigPath = join(dir, "app.yaml");
    const secretsPath = join(dir, "secrets.yaml");

    const appConfig = {
      providers: [
        { id: "openai", model: "gpt-4o", apiKey: "env", priority: 1 },
      ],
      workspace: "./workspace",
    };

    // Even if secrets.yaml has an API key, it should be ignored when apiKey: "env"
    const secrets = {
      openai: { apiKey: "sk-secret-should-be-ignored" },
    };

    await writeFile(appConfigPath, stringify(appConfig, { indent: 2 }), "utf-8");
    await writeFile(secretsPath, stringify(secrets, { indent: 2 }), "utf-8");

    const config = await loadConfig(appConfigPath);

    expect(config.providers[0]?.apiKey).toBe("sk-env-openai-key");
  });
});
