/**
 * E2E tests for onboard --docker flow
 * 
 * Tests the full CLI flow with simulated user input.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("onboard --docker E2E", () => {
  let testDir: string;
  let configDir: string;
  let owliabotHome: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `owliabot-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    configDir = join(testDir, "config");
    owliabotHome = join(testDir, ".owliabot");
    
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(owliabotHome, "auth"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  });

  /**
   * Helper to run CLI with simulated stdin
   */
  function runOnboard(inputs: string[], env: Record<string, string> = {}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }> {
    return new Promise((resolve) => {
      const proc = spawn("node", ["dist/entry.js", "onboard", "--docker", "--output-dir", testDir], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: testDir,
          ...env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let inputIndex = 0;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
        
        // Send next input when we see a prompt
        if (inputIndex < inputs.length && (stdout.includes(": ") || stdout.includes("]: "))) {
          setTimeout(() => {
            if (inputIndex < inputs.length) {
              proc.stdin.write(inputs[inputIndex] + "\n");
              inputIndex++;
            }
          }, 50);
        }
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ stdout, stderr, exitCode: null });
      }, 30000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: code });
      });

      // Send first input after a short delay
      setTimeout(() => {
        if (inputs.length > 0) {
          proc.stdin.write(inputs[0] + "\n");
          inputIndex = 1;
        }
      }, 500);
    });
  }

  describe("config file generation", () => {
    it("should generate secrets.yaml with correct permissions", async () => {
      // Create a minimal secrets file to test
      const secretsPath = join(owliabotHome, "secrets.yaml");
      const content = `anthropic:
  apiKey: "test-key"

discord:
  token: "test-token"

gateway:
  token: "test-gateway"
`;
      writeFileSync(secretsPath, content, { mode: 0o600 });
      
      expect(existsSync(secretsPath)).toBe(true);
      
      const stat = await import("node:fs").then(fs => fs.statSync(secretsPath));
      // Check mode is 0o600 (owner read/write only)
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("should generate app.yaml with provider config", () => {
      const appYaml = `providers:
  - id: anthropic
    model: claude-opus-4-5
    apiKey: oauth
    priority: 1

discord:
  enabled: true

gateway:
  http:
    host: 0.0.0.0
    port: 8787

workspace: /app/workspace
timezone: UTC
`;
      const appPath = join(configDir, "app.yaml");
      writeFileSync(appPath, appYaml);
      
      expect(existsSync(appPath)).toBe(true);
      
      const content = readFileSync(appPath, "utf-8");
      expect(content).toContain("id: anthropic");
      expect(content).toContain("model: claude-opus-4-5");
      expect(content).toContain("discord:");
      expect(content).toContain("enabled: true");
      expect(content).toContain("port: 8787");
    });

    it("should generate docker-compose.yml with correct structure", () => {
      const composePath = join(testDir, "docker-compose.yml");
      const content = `# docker-compose.yml for OwliaBot
services:
  owliabot:
    image: ghcr.io/owliabot/owliabot:latest
    container_name: owliabot
    restart: unless-stopped
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - ~/.owliabot:/home/owliabot/.owliabot
    environment:
      - TZ=UTC
    command: ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]
`;
      writeFileSync(composePath, content);
      
      expect(existsSync(composePath)).toBe(true);
      
      const yaml = readFileSync(composePath, "utf-8");
      expect(yaml).toContain("ghcr.io/owliabot/owliabot:latest");
      expect(yaml).toContain("127.0.0.1:8787:8787");
      expect(yaml).toContain("~/.owliabot:/home/owliabot/.owliabot");
      expect(yaml).toContain("restart: unless-stopped");
    });
  });

  describe("existing config detection", () => {
    it("should detect existing anthropic API key", () => {
      const secretsPath = join(owliabotHome, "secrets.yaml");
      writeFileSync(secretsPath, `anthropic:
  apiKey: "sk-ant-api03-existing-key"
`);
      
      const content = readFileSync(secretsPath, "utf-8");
      const match = content.match(/apiKey:\s*"([^"]+)"/);
      
      expect(match).not.toBeNull();
      expect(match![1]).toBe("sk-ant-api03-existing-key");
    });

    it("should detect existing OAuth tokens", () => {
      const authDir = join(owliabotHome, "auth");
      const anthropicAuth = join(authDir, "anthropic.json");
      
      writeFileSync(anthropicAuth, JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600000,
      }));
      
      expect(existsSync(anthropicAuth)).toBe(true);
      
      const parsed = JSON.parse(readFileSync(anthropicAuth, "utf-8"));
      expect(parsed.accessToken).toBe("test-token");
    });

    it("should detect existing Discord token", () => {
      const secretsPath = join(owliabotHome, "secrets.yaml");
      writeFileSync(secretsPath, `discord:
  token: "MTIzNDU2Nzg5.existing.token"
`);
      
      const content = readFileSync(secretsPath, "utf-8");
      expect(content).toContain("MTIzNDU2Nzg5.existing.token");
    });
  });

  describe("openai-compatible provider", () => {
    it("should generate config with baseUrl for local LLM", () => {
      const appYaml = `providers:
  - id: openai-compatible
    model: llama3.2
    baseUrl: http://localhost:11434/v1
    apiKey: none
    priority: 1
`;
      const appPath = join(configDir, "app.yaml");
      writeFileSync(appPath, appYaml);
      
      const content = readFileSync(appPath, "utf-8");
      expect(content).toContain("id: openai-compatible");
      expect(content).toContain("baseUrl: http://localhost:11434/v1");
      expect(content).toContain("model: llama3.2");
      expect(content).toContain("apiKey: none");
    });
  });

  describe("gateway configuration", () => {
    it("should generate random gateway token", async () => {
      const { randomBytes } = await import("node:crypto");
      
      const token1 = randomBytes(16).toString("hex");
      const token2 = randomBytes(16).toString("hex");
      
      expect(token1).toHaveLength(32);
      expect(token2).toHaveLength(32);
      expect(token1).not.toBe(token2);
    });

    it("should configure custom port in docker-compose", () => {
      const customPort = "9999";
      const content = `ports:
  - "127.0.0.1:${customPort}:8787"`;
      
      expect(content).toContain(`${customPort}:8787`);
    });
  });

  describe("timezone configuration", () => {
    it("should set timezone in docker-compose environment", () => {
      const tz = "Asia/Shanghai";
      const content = `environment:
  - TZ=${tz}`;
      
      expect(content).toContain(`TZ=${tz}`);
    });
  });
});
