import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEV_APP_DIR,
  DEV_APP_CONFIG_PATH,
  loadAppConfig,
  saveAppConfig,
} from "../storage.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse, stringify } from "yaml";
import type { AppConfig } from "../types.js";

vi.mock("node:fs/promises");
vi.mock("yaml");

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constants", () => {
    it("should export DEV_APP_DIR", () => {
      expect(DEV_APP_DIR).toBeDefined();
      expect(typeof DEV_APP_DIR).toBe("string");
    });

    it("should export DEV_APP_CONFIG_PATH", () => {
      expect(DEV_APP_CONFIG_PATH).toBeDefined();
      expect(DEV_APP_CONFIG_PATH).toContain("app.yaml");
    });
  });

  describe("loadAppConfig", () => {
    it("should load and parse app config", async () => {
      const mockConfig: AppConfig = {
        workspace: "./workspace",
        providers: [
          {
            id: "anthropic",
            model: "claude-sonnet-4-5",
            apiKey: "oauth",
            priority: 1,
          },
        ],
      };

      vi.mocked(readFile).mockResolvedValue("config: yaml");
      vi.mocked(parse).mockReturnValue(mockConfig);

      const result = await loadAppConfig("/test/app.yaml");

      expect(result).toEqual(mockConfig);
      expect(readFile).toHaveBeenCalledWith("/test/app.yaml", "utf-8");
    });

    it("should use default path when none provided", async () => {
      vi.mocked(readFile).mockResolvedValue("config: yaml");
      vi.mocked(parse).mockReturnValue({ workspace: ".", providers: [] });

      await loadAppConfig();

      expect(readFile).toHaveBeenCalledWith(DEV_APP_CONFIG_PATH, "utf-8");
    });

    it("should return null when file doesn't exist", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const result = await loadAppConfig("/test/app.yaml");

      expect(result).toBeNull();
    });

    it("should throw on other errors", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("Permission denied"));

      await expect(loadAppConfig("/test/app.yaml")).rejects.toThrow("Permission denied");
    });
  });

  describe("saveAppConfig", () => {
    it("should save app config to YAML file", async () => {
      const config: AppConfig = {
        workspace: "./workspace",
        providers: [
          {
            id: "anthropic",
            model: "claude-sonnet-4-5",
            apiKey: "oauth",
            priority: 1,
          },
        ],
      };

      vi.mocked(stringify).mockReturnValue("yaml: content");
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveAppConfig(config, "/test/app.yaml");

      expect(mkdir).toHaveBeenCalled();
      expect(stringify).toHaveBeenCalledWith(config, { indent: 2 });
      expect(writeFile).toHaveBeenCalledWith(
        "/test/app.yaml",
        "yaml: content",
        "utf-8"
      );
    });

    it("should use default path when none provided", async () => {
      const config: AppConfig = {
        workspace: ".",
        providers: [],
      };

      vi.mocked(stringify).mockReturnValue("yaml: content");
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveAppConfig(config);

      expect(writeFile).toHaveBeenCalledWith(
        DEV_APP_CONFIG_PATH,
        "yaml: content",
        "utf-8"
      );
    });

    it("should create parent directories", async () => {
      const config: AppConfig = {
        workspace: ".",
        providers: [],
      };

      vi.mocked(stringify).mockReturnValue("yaml: content");
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveAppConfig(config, "/deep/nested/path/app.yaml");

      expect(mkdir).toHaveBeenCalledWith(
        "/deep/nested/path",
        { recursive: true }
      );
    });
  });
});
