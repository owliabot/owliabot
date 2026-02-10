/**
 * Unit tests for onboarding/steps/config-detection.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectExistingConfig } from "../steps/config-detection.js";

describe("config-detection", () => {
  let testDir: string;
  let appConfigPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "owliabot-detect-test-"));
    appConfigPath = join(testDir, "app.yaml");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should return null when no config exists", async () => {
    const result = await detectExistingConfig(false, appConfigPath);
    expect(result).toBeNull();
  });

  it("should detect anthropic API key from secrets.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `anthropic:
  apiKey: sk-ant-api03-test123`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.anthropicKey).toBe("sk-ant-api03-test123");
  });

  it("should detect anthropic setup token from secrets.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `anthropic:
  token: sk-ant-oat01-test456`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.anthropicToken).toBe("sk-ant-oat01-test456");
  });

  it("should detect discord token from secrets.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `discord:
  token: discord-bot-token-123`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.discordToken).toBe("discord-bot-token-123");
  });

  it("should detect telegram token from secrets.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `telegram:
  token: 123456:ABC-DEF`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.telegramToken).toBe("123456:ABC-DEF");
  });

  it("should detect gateway token from secrets.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `gateway:
  token: gateway-token-abc123`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.gatewayToken).toBe("gateway-token-abc123");
  });

  it("should detect telegram allowList from app.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `telegram:
  token: test-token`);
    
    writeFileSync(appConfigPath, `workspace: workspace
telegram:
  allowList:
    - "123456"
    - "789012"`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.telegramAllowList).toEqual(["123456", "789012"]);
  });

  it("should detect telegram groups from app.yaml", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `telegram:
  token: test-token`);
    
    writeFileSync(appConfigPath, `workspace: workspace
telegram:
  groups:
    "-100123":
      enabled: true
      requireMention: false`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.telegramGroups).toBeDefined();
    expect(result?.telegramGroups?.["-100123"]).toEqual({
      enabled: true,
      requireMention: false,
    });
  });

  it("should not treat env placeholder as existing telegram token", async () => {
    writeFileSync(appConfigPath, `workspace: workspace
telegram:
  token: "\${TELEGRAM_BOT_TOKEN}"`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    // Should not detect the env placeholder
    expect(result?.telegramToken).toBeUndefined();
  });

  it("should detect real telegram token from app.yaml", async () => {
    writeFileSync(appConfigPath, `workspace: workspace
telegram:
  token: "123456:ABC-DEF"`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result?.telegramToken).toBe("123456:ABC-DEF");
  });

  it("should detect multiple secrets and config values", async () => {
    const secretsPath = join(testDir, "secrets.yaml");
    writeFileSync(secretsPath, `anthropic:
  apiKey: sk-ant-api03-key
discord:
  token: discord-token
gateway:
  token: gateway-token`);
    
    writeFileSync(appConfigPath, `workspace: workspace
telegram:
  allowList:
    - "12345"
  groups:
    "-100456":
      enabled: true`);
    
    const result = await detectExistingConfig(false, appConfigPath);
    
    expect(result).not.toBeNull();
    expect(result?.anthropicKey).toBe("sk-ant-api03-key");
    expect(result?.discordToken).toBe("discord-token");
    expect(result?.gatewayToken).toBe("gateway-token");
    expect(result?.telegramAllowList).toEqual(["12345"]);
    expect(result?.telegramGroups).toBeDefined();
  });
});
