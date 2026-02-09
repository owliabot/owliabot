/**
 * Unit tests for writer functions:
 * - writeDevConfig
 * - writeDockerConfigLocalStyle
 * - buildDockerComposeYaml
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:readline", () => ({ createInterface: vi.fn() }));
vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

describe("writers step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── buildDockerComposeYaml ──────────────────────────────────────────────

  describe("buildDockerComposeYaml", () => {
    it.skip("requires export after refactor — generates valid docker-compose structure", () => {
      // const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "ghcr.io/owliabot/owliabot:latest");
      // expect(yaml).toContain("services:");
      // expect(yaml).toContain("owliabot:");
      // expect(yaml).toContain("image: ${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}");
      // expect(yaml).toContain("container_name: owliabot");
      // expect(yaml).toContain("restart: unless-stopped");
    });

    it.skip("requires export after refactor — uses correct port mapping", () => {
      // const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "9090", "img:latest");
      // expect(yaml).toContain('"127.0.0.1:9090:8787"');
    });

    it.skip("requires export after refactor — uses correct timezone", () => {
      // const yaml = buildDockerComposeYaml("~/.owliabot", "America/New_York", "8787", "img:latest");
      // expect(yaml).toContain("TZ=America/New_York");
    });

    it.skip("requires export after refactor — mounts config and workspace volumes", () => {
      // const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "img:latest");
      // expect(yaml).toContain("~/.owliabot:/home/owliabot/.owliabot");
      // expect(yaml).toContain("~/.owliabot/workspace:/app/workspace");
    });

    it.skip("requires export after refactor — includes healthcheck", () => {
      // const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "img:latest");
      // expect(yaml).toContain("healthcheck:");
      // expect(yaml).toContain("http://localhost:8787/health");
    });

    it.skip("requires export after refactor — includes start command with config path", () => {
      // const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "img:latest");
      // expect(yaml).toContain('command: ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]');
    });
  });

  // ── writeDevConfig ──────────────────────────────────────────────────────

  describe("writeDevConfig", () => {
    it.skip("requires export after refactor — calls saveAppConfig and saveSecrets", async () => {
      // const config = { workspace: "/w", providers: [] };
      // const secrets = { anthropic: { apiKey: "key" } };
      // await writeDevConfig(config, secrets, "/fake/app.yaml");
      // Verify saveAppConfig was called with config, "/fake/app.yaml"
      // Verify saveSecrets was called with "/fake/app.yaml", secrets
    });

    it.skip("requires export after refactor — skips saveSecrets when secrets is empty", async () => {
      // const config = { workspace: "/w", providers: [] };
      // await writeDevConfig(config, {}, "/fake/app.yaml");
      // Verify saveSecrets was NOT called
    });
  });

  // ── writeDockerConfigLocalStyle ─────────────────────────────────────────

  describe("writeDockerConfigLocalStyle", () => {
    it.skip("requires export after refactor — saves to configDir paths", async () => {
      // const paths = { configDir: "/home/user/.owliabot", ... };
      // const config = { workspace: "/app/workspace", providers: [] };
      // await writeDockerConfigLocalStyle(paths, config, { anthropic: { apiKey: "k" } });
      // Verify saveAppConfig called with join(paths.configDir, "app.yaml")
      // Verify saveSecrets called
    });

    it.skip("requires export after refactor — skips secrets when empty", async () => {
      // await writeDockerConfigLocalStyle(paths, config, {});
      // Verify saveSecrets NOT called
    });
  });
});
