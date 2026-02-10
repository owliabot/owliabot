/**
 * Unit tests for onboarding/steps/docker.ts
 */

import { describe, it, expect } from "vitest";
import { buildDockerEnvLines, buildDockerComposeYaml, initDockerPaths } from "../steps/docker.js";
import type { AppConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";

describe("docker", () => {
  describe("initDockerPaths", () => {
    it("should return docker paths with default output dir", () => {
      const paths = initDockerPaths();
      
      expect(paths.configDir).toContain(".owliabot");
      expect(paths.dockerConfigPath).toBe("~/.owliabot");
      expect(paths.shellConfigPath).toBe("~/.owliabot");
      expect(paths.outputDir).toBe(".");
    });

    it("should use custom output dir when provided", () => {
      const paths = initDockerPaths("/custom/output");
      
      expect(paths.outputDir).toBe("/custom/output");
    });
  });

  describe("buildDockerEnvLines", () => {
    it("should include timezone in env lines", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [],
      };
      const secrets: SecretsConfig = {};
      
      const result = buildDockerEnvLines(config, secrets, "America/New_York");
      
      expect(result).toContain("TZ=America/New_York");
    });

    it("should include Discord token placeholder when not in secrets", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [],
        discord: { requireMentionInGuild: true },
      };
      const secrets: SecretsConfig = {};
      
      const result = buildDockerEnvLines(config, secrets, "UTC");
      
      expect(result).toContain("DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}");
    });

    it("should not include Discord token placeholder when in secrets", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [],
        discord: { requireMentionInGuild: true },
      };
      const secrets: SecretsConfig = {
        discord: { token: "test-token" },
      };
      
      const result = buildDockerEnvLines(config, secrets, "UTC");
      
      const discordLine = result.find(line => line.includes("DISCORD_BOT_TOKEN"));
      expect(discordLine).toBeUndefined();
    });

    it("should include Telegram token placeholder when not in secrets", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [],
        telegram: {},
      };
      const secrets: SecretsConfig = {};
      
      const result = buildDockerEnvLines(config, secrets, "UTC");
      
      expect(result).toContain("TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}");
    });

    it("should include Anthropic API key placeholder when provider uses env", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [
          {
            id: "anthropic",
            model: "claude-opus-4-5",
            apiKey: "env",
            priority: 1,
          } as any,
        ],
      };
      const secrets: SecretsConfig = {};
      
      const result = buildDockerEnvLines(config, secrets, "UTC");
      
      expect(result).toContain("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
    });

    it("should include OpenAI API key placeholder when provider uses env", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [
          {
            id: "openai",
            model: "gpt-5.2",
            apiKey: "env",
            priority: 1,
          } as any,
        ],
      };
      const secrets: SecretsConfig = {};
      
      const result = buildDockerEnvLines(config, secrets, "UTC");
      
      expect(result).toContain("OPENAI_API_KEY=${OPENAI_API_KEY}");
    });

    it("should not include provider keys when using secrets", () => {
      const config: AppConfig = {
        workspace: "workspace",
        providers: [
          {
            id: "anthropic",
            model: "claude-opus-4-5",
            apiKey: "secrets",
            priority: 1,
          } as any,
        ],
      };
      const secrets: SecretsConfig = {
        anthropic: { apiKey: "test-key" },
      };
      
      const result = buildDockerEnvLines(config, secrets, "UTC");
      
      const anthropicLine = result.find(line => line.includes("ANTHROPIC_API_KEY"));
      expect(anthropicLine).toBeUndefined();
    });
  });

  describe("buildDockerComposeYaml", () => {
    it("should generate valid docker-compose.yml with basic config", () => {
      const yaml = buildDockerComposeYaml(
        "~/.owliabot",
        ["TZ=UTC"],
        "8787",
        "ghcr.io/owliabot/owliabot:latest"
      );
      
      expect(yaml).toContain("services:");
      expect(yaml).toContain("owliabot:");
      expect(yaml).toContain("image: ${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}");
      expect(yaml).toContain("container_name: owliabot");
      expect(yaml).toContain("restart: unless-stopped");
      expect(yaml).toContain("127.0.0.1:8787:8787");
      expect(yaml).toContain("~/.owliabot:/home/owliabot/.owliabot");
      expect(yaml).toContain("TZ=UTC");
    });

    it("should include all environment variables", () => {
      const yaml = buildDockerComposeYaml(
        "~/.owliabot",
        ["TZ=UTC", "DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}", "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"],
        "9000",
        "custom-image:latest"
      );
      
      expect(yaml).toContain("TZ=UTC");
      expect(yaml).toContain("DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}");
      expect(yaml).toContain("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
    });

    it("should use custom port binding", () => {
      const yaml = buildDockerComposeYaml(
        "~/.owliabot",
        ["TZ=UTC"],
        "9090",
        "test:latest"
      );
      
      expect(yaml).toContain("127.0.0.1:9090:8787");
    });

    it("should use custom image when provided", () => {
      const yaml = buildDockerComposeYaml(
        "~/.owliabot",
        ["TZ=UTC"],
        "8787",
        "my-custom-image:v1.0"
      );
      
      expect(yaml).toContain("${OWLIABOT_IMAGE:-my-custom-image:v1.0}");
    });

    it("should include healthcheck configuration", () => {
      const yaml = buildDockerComposeYaml(
        "~/.owliabot",
        ["TZ=UTC"],
        "8787",
        "test:latest"
      );
      
      expect(yaml).toContain("healthcheck:");
      expect(yaml).toContain('test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]');
      expect(yaml).toContain("interval: 5s");
      expect(yaml).toContain("timeout: 3s");
      expect(yaml).toContain("retries: 3");
      expect(yaml).toContain("start_period: 10s");
    });

    it("should include both volume mounts", () => {
      const yaml = buildDockerComposeYaml(
        "~/.owliabot",
        ["TZ=UTC"],
        "8787",
        "test:latest"
      );
      
      expect(yaml).toContain("~/.owliabot:/home/owliabot/.owliabot");
      expect(yaml).toContain("~/.owliabot/workspace:/app/workspace");
    });
  });
});
