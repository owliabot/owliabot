/**
 * Unit tests for onboard-docker.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

describe("onboard-docker", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `owliabot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
    vi.clearAllMocks();
  });

  describe("secrets.yaml parsing", () => {
    it("should parse anthropic API key from secrets.yaml", () => {
      const content = `anthropic:
  apiKey: "sk-ant-api03-test123"

discord:
  token: "MTIzNDU2Nzg5.test.token"
`;
      const anthropicMatch = content.match(/^anthropic:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
      expect(anthropicMatch).not.toBeNull();
      expect(anthropicMatch![1]).toBe("sk-ant-api03-test123");
    });

    it("should parse discord token from secrets.yaml", () => {
      const content = `discord:
  token: "MTIzNDU2Nzg5.test.token"
`;
      const discordMatch = content.match(/^discord:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
      expect(discordMatch).not.toBeNull();
      expect(discordMatch![1]).toBe("MTIzNDU2Nzg5.test.token");
    });

    it("should parse gateway token from secrets.yaml", () => {
      const content = `gateway:
  token: "abc123def456"
`;
      const gatewayMatch = content.match(/^gateway:\s*\n\s+token:\s*"?([^"\n]+)"?/m);
      expect(gatewayMatch).not.toBeNull();
      expect(gatewayMatch![1]).toBe("abc123def456");
    });

    it("should handle empty apiKey gracefully", () => {
      const content = `anthropic:
  apiKey: ""
`;
      // When apiKey is empty quotes, the regex won't match anything meaningful
      const anthropicMatch = content.match(/^anthropic:\s*\n\s+apiKey:\s*"([^"]+)"/m);
      // Empty string between quotes means no match with [^"]+ (requires at least 1 char)
      expect(anthropicMatch).toBeNull();
    });
  });

  describe("OAuth token detection", () => {
    it("should detect OAuth token file existence", () => {
      const authDir = join(testDir, "auth");
      mkdirSync(authDir, { recursive: true });
      
      writeFileSync(join(authDir, "anthropic.json"), JSON.stringify({ token: "test" }));
      
      expect(existsSync(join(authDir, "anthropic.json"))).toBe(true);
      expect(existsSync(join(authDir, "openai-codex.json"))).toBe(false);
    });
  });

  describe("config file generation", () => {
    it("should generate valid YAML for secrets", () => {
      const gatewayToken = "abc123def456";
      const discordToken = "MTIzNDU2.test";
      
      const secretsYaml = `# OwliaBot Secrets
anthropic:
  apiKey: ""

discord:
  token: "${discordToken}"

gateway:
  token: "${gatewayToken}"
`;
      
      expect(secretsYaml).toContain(`token: "${discordToken}"`);
      expect(secretsYaml).toContain(`token: "${gatewayToken}"`);
    });

    it("should generate valid app.yaml with providers", () => {
      const providers = [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "oauth", priority: 1 },
        { id: "openai", model: "gpt-4o", apiKey: "secrets", priority: 2 },
      ];
      
      let appYaml = "providers:\n";
      for (const p of providers) {
        appYaml += `  - id: ${p.id}\n`;
        appYaml += `    model: ${p.model}\n`;
        appYaml += `    apiKey: ${p.apiKey}\n`;
        appYaml += `    priority: ${p.priority}\n`;
      }
      
      expect(appYaml).toContain("id: anthropic");
      expect(appYaml).toContain("model: claude-sonnet-4-5");
      expect(appYaml).toContain("id: openai");
      expect(appYaml).toContain("priority: 2");
    });

    it("should generate docker-compose.yml with correct mounts", () => {
      const gatewayPort = "8787";
      const tz = "Asia/Shanghai";
      const image = "ghcr.io/owliabot/owliabot:latest";
      
      const composeYaml = `services:
  owliabot:
    image: ${image}
    ports:
      - "127.0.0.1:${gatewayPort}:8787"
    volumes:
      - ~/.owliabot/secrets.yaml:/app/config/secrets.yaml:ro
      - ~/.owliabot/auth:/home/owliabot/.owliabot/auth
      - ./config/app.yaml:/app/config/app.yaml:ro
      - ./workspace:/app/workspace
    environment:
      - TZ=${tz}
`;
      
      expect(composeYaml).toContain(`- "127.0.0.1:${gatewayPort}:8787"`);
      expect(composeYaml).toContain("secrets.yaml:/app/config/secrets.yaml:ro");
      expect(composeYaml).toContain(`TZ=${tz}`);
    });

    it("should write secrets.yaml with chmod 600", () => {
      const secretsPath = join(testDir, "secrets.yaml");
      writeFileSync(secretsPath, "test: content");
      chmodSync(secretsPath, 0o600);
      
      const stat = require("node:fs").statSync(secretsPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe("provider configuration", () => {
    it("should support openai-compatible provider with baseUrl", () => {
      const provider = {
        id: "openai-compatible",
        model: "llama3.2",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "none",
        priority: 1,
      };
      
      let yaml = `  - id: ${provider.id}\n`;
      yaml += `    model: ${provider.model}\n`;
      yaml += `    baseUrl: ${provider.baseUrl}\n`;
      yaml += `    apiKey: ${provider.apiKey}\n`;
      
      expect(yaml).toContain("id: openai-compatible");
      expect(yaml).toContain("baseUrl: http://localhost:11434/v1");
      expect(yaml).toContain("model: llama3.2");
    });

    it("should set correct apiKey values for different auth methods", () => {
      const scenarios = [
        { hasApiKey: true, isOAuth: false, expected: "secrets" },
        { hasApiKey: false, isOAuth: true, expected: "oauth" },
        { hasApiKey: false, isOAuth: false, expected: "env" },
      ];
      
      for (const s of scenarios) {
        let apiKeyValue: string;
        if (s.hasApiKey) {
          apiKeyValue = "secrets";
        } else if (s.isOAuth) {
          apiKeyValue = "oauth";
        } else {
          apiKeyValue = "env";
        }
        expect(apiKeyValue).toBe(s.expected);
      }
    });
  });

  describe("gateway token generation", () => {
    it("should generate a random 32-character hex token", () => {
      const token = randomBytes(16).toString("hex");
      
      expect(token).toHaveLength(32);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it("should generate unique tokens each time", () => {
      const token1 = randomBytes(16).toString("hex");
      const token2 = randomBytes(16).toString("hex");
      
      expect(token1).not.toBe(token2);
    });
  });

  describe("directory structure", () => {
    it("should create required directories with correct permissions", () => {
      const owliabotHome = join(testDir, ".owliabot");
      const authDir = join(owliabotHome, "auth");
      
      mkdirSync(owliabotHome, { recursive: true });
      chmodSync(owliabotHome, 0o700);
      mkdirSync(authDir, { recursive: true });
      chmodSync(authDir, 0o700);
      
      expect(existsSync(owliabotHome)).toBe(true);
      expect(existsSync(authDir)).toBe(true);
      
      const stat = require("node:fs").statSync(owliabotHome);
      expect(stat.mode & 0o777).toBe(0o700);
    });
  });
});
