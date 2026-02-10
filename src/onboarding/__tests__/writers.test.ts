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

const mockSaveAppConfig = vi.fn().mockResolvedValue(undefined);
const mockSaveSecrets = vi.fn().mockResolvedValue(undefined);

vi.mock("../storage.js", () => ({
  saveAppConfig: (...args: any[]) => mockSaveAppConfig(...args),
  loadAppConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("../secrets.js", () => ({
  saveSecrets: (...args: any[]) => mockSaveSecrets(...args),
  loadSecrets: vi.fn().mockReturnValue({}),
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  writeDevConfig,
  writeDockerConfigLocalStyle,
  buildDockerComposeYaml,
} from "../steps/writers.js";

describe("writers step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSaveAppConfig.mockClear();
    mockSaveSecrets.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── buildDockerComposeYaml ──────────────────────────────────────────────

  describe("buildDockerComposeYaml", () => {
    it("generates valid docker-compose structure", () => {
      const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "ghcr.io/owliabot/owliabot:latest");
      expect(yaml).toContain("services:");
      expect(yaml).toContain("owliabot:");
      expect(yaml).toContain("image: ${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}");
      expect(yaml).toContain("container_name: owliabot");
      expect(yaml).toContain("restart: unless-stopped");
    });

    it("uses correct port mapping", () => {
      const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "9090", "img:latest");
      expect(yaml).toContain('"127.0.0.1:9090:8787"');
    });

    it("uses correct timezone", () => {
      const yaml = buildDockerComposeYaml("~/.owliabot", "America/New_York", "8787", "img:latest");
      expect(yaml).toContain("TZ=America/New_York");
    });

    it("mounts config and workspace volumes", () => {
      const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "img:latest");
      expect(yaml).toContain("~/.owliabot:/home/owliabot/.owliabot");
      expect(yaml).toContain("~/.owliabot/workspace:/app/workspace");
    });

    it("includes healthcheck", () => {
      const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "img:latest");
      expect(yaml).toContain("healthcheck:");
      expect(yaml).toContain("http://localhost:8787/health");
    });

    it("includes start command with config path", () => {
      const yaml = buildDockerComposeYaml("~/.owliabot", "UTC", "8787", "img:latest");
      expect(yaml).toContain('command: ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]');
    });
  });

  // ── writeDevConfig ──────────────────────────────────────────────────────

  describe("writeDevConfig", () => {
    it("calls saveAppConfig and saveSecrets", async () => {
      const config = { workspace: "/w", providers: [] } as any;
      const secrets = { anthropic: { apiKey: "key" } };
      await writeDevConfig(config, secrets, "/fake/app.yaml");
      expect(mockSaveAppConfig).toHaveBeenCalledWith(config, "/fake/app.yaml");
      expect(mockSaveSecrets).toHaveBeenCalledWith("/fake/app.yaml", secrets);
    });

    it("skips saveSecrets when secrets is empty", async () => {
      const config = { workspace: "/w", providers: [] } as any;
      await writeDevConfig(config, {}, "/fake/app.yaml");
      expect(mockSaveAppConfig).toHaveBeenCalledWith(config, "/fake/app.yaml");
      expect(mockSaveSecrets).not.toHaveBeenCalled();
    });
  });

  // ── writeDockerConfigLocalStyle ─────────────────────────────────────────

  describe("writeDockerConfigLocalStyle", () => {
    it("saves to configDir paths", async () => {
      const paths = { configDir: "/home/user/.owliabot" } as any;
      const config = { workspace: "/app/workspace", providers: [] } as any;
      await writeDockerConfigLocalStyle(paths, config, { anthropic: { apiKey: "k" } });
      expect(mockSaveAppConfig).toHaveBeenCalledWith(config, expect.stringContaining("app.yaml"));
      expect(mockSaveSecrets).toHaveBeenCalledWith(
        expect.stringContaining("app.yaml"),
        { anthropic: { apiKey: "k" } },
      );
    });

    it("skips secrets when empty", async () => {
      const paths = { configDir: "/home/user/.owliabot" } as any;
      const config = { workspace: "/app/workspace", providers: [] } as any;
      await writeDockerConfigLocalStyle(paths, config, {});
      expect(mockSaveAppConfig).toHaveBeenCalled();
      expect(mockSaveSecrets).not.toHaveBeenCalled();
    });
  });
});
