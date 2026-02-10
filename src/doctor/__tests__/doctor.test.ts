import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";

import { configSchema } from "../../config/schema.js";
import {
  diagnoseDoctor,
  resetConfigFile,
  setChannelToken,
  deleteChannelToken,
  setProviderSecret,
  deleteProviderSecret,
} from "../index.js";

describe("doctor", () => {
  it("reports missing config file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      const report = await diagnoseDoctor({ configPath, env: {} });
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.id)).toContain("config.missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports YAML parse error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(configPath, "providers: [", "utf-8");
      const report = await diagnoseDoctor({ configPath, env: {} });
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.id)).toContain("config.parse_error");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects invalid telegram token in secrets.yaml and can delete it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    priority: 1",
          "telegram: {}",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["telegram:", "  token: badtoken", ""].join("\n"),
        "utf-8",
      );

      const report = await diagnoseDoctor({ configPath, env: {} });
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.id)).toContain(
        "credential.telegram.token.invalid_format",
      );

      await deleteChannelToken({ configPath, channel: "telegram" });
      const secrets = parse(
        await readFile(path.join(dir, "secrets.yaml"), "utf-8"),
      ) as any;
      expect(secrets.telegram?.token).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects invalid discord token in secrets.yaml and can delete it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    priority: 1",
          "discord: {}",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["discord:", "  token: badtoken", ""].join("\n"),
        "utf-8",
      );

      const report = await diagnoseDoctor({ configPath, env: {} });
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.id)).toContain(
        "credential.discord.token.invalid_format",
      );

      await deleteChannelToken({ configPath, channel: "discord" });
      const secrets = parse(
        await readFile(path.join(dir, "secrets.yaml"), "utf-8"),
      ) as any;
      expect(secrets.discord?.token).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects invalid OpenAI apiKey in secrets.yaml when provider uses secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: openai",
          "    model: gpt-5.2",
          "    apiKey: secrets",
          "    priority: 1",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["openai:", "  apiKey: badkey", ""].join("\n"),
        "utf-8",
      );

      const report = await diagnoseDoctor({ configPath, env: {} });
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.id)).toContain(
        "credential.openai.apiKey.invalid_format",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects invalid Anthropic token in secrets.yaml when provider uses secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    apiKey: secrets",
          "    priority: 1",
          "",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["anthropic:", "  token: not-a-real-token", ""].join("\n"),
        "utf-8",
      );

      const report = await diagnoseDoctor({ configPath, env: {} });
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.id)).toContain(
        "credential.anthropic.token.invalid_format",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setChannelToken stores token in secrets.yaml and clears config token", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    priority: 1",
          "telegram:",
          "  token: badtoken",
          "",
        ].join("\n"),
        "utf-8",
      );

      const goodToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghij";
      await setChannelToken({ configPath, channel: "telegram", token: goodToken });

      const updatedConfig = parse(await readFile(configPath, "utf-8")) as any;
      expect(updatedConfig.telegram?.token).toBeUndefined();

      const secrets = parse(
        await readFile(path.join(dir, "secrets.yaml"), "utf-8"),
      ) as any;
      expect(secrets.telegram?.token).toBe(goodToken);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setProviderSecret writes OpenAI apiKey to secrets.yaml", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: openai",
          "    model: gpt-5.2",
          "    apiKey: secrets",
          "    priority: 1",
          "",
        ].join("\n"),
        "utf-8",
      );

      const key = "sk-proj-test_abcdefghijklmnopqrstuvwxyz0123456789";
      await setProviderSecret({ configPath, provider: "openai", field: "apiKey", value: key });

      const secrets = parse(
        await readFile(path.join(dir, "secrets.yaml"), "utf-8"),
      ) as any;
      expect(secrets.openai?.apiKey).toBe(key);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deleteProviderSecret removes Anthropic token from secrets.yaml", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(
        configPath,
        [
          "providers:",
          "  - id: anthropic",
          "    model: claude-sonnet-4-5",
          "    apiKey: secrets",
          "    priority: 1",
          "",
        ].join("\n"),
        "utf-8",
      );

      await writeFile(
        path.join(dir, "secrets.yaml"),
        ["anthropic:", "  token: sk-ant-oat01-test_abcdefghijklmnopqrstuvwxyz0123456789", ""].join("\n"),
        "utf-8",
      );

      await deleteProviderSecret({ configPath, provider: "anthropic", field: "token" });

      const secrets = parse(
        await readFile(path.join(dir, "secrets.yaml"), "utf-8"),
      ) as any;
      expect(secrets.anthropic?.token).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resetConfigFile backs up and writes a valid minimal config", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "owliabot-doctor-"));
    try {
      const configPath = path.join(dir, "app.yaml");
      await writeFile(configPath, "providers: [", "utf-8");

      await resetConfigFile({
        configPath,
        backup: true,
        now: new Date("2026-02-10T00:00:00Z"),
      });

      const files = await readdir(dir);
      expect(files.some((f) => f.startsWith("app.yaml.bak."))).toBe(true);

      const cfgObj = parse(await readFile(configPath, "utf-8"));
      expect(() => configSchema.parse(cfgObj)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
