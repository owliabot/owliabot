import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSecretsPath,
  loadSecrets,
  saveSecrets,
} from "../secrets.js";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { parse, stringify } from "yaml";

vi.mock("node:fs/promises");
vi.mock("yaml");

describe("secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSecretsPath", () => {
    it("should return secrets.yaml in same directory as app config", () => {
      const path = getSecretsPath("/home/user/app/config.yaml");
      expect(path).toBe("/home/user/app/secrets.yaml");
    });

    it("should handle nested paths", () => {
      const path = getSecretsPath("/path/to/config/app.yaml");
      expect(path).toBe("/path/to/config/secrets.yaml");
    });
  });

  describe("loadSecrets", () => {
    it("should load and parse secrets file", async () => {
      const mockSecrets = {
        discord: { token: "discord-token-123" },
        telegram: { token: "telegram-token-456" },
      };

      vi.mocked(readFile).mockResolvedValue("secrets: yaml");
      vi.mocked(parse).mockReturnValue(mockSecrets);

      const result = await loadSecrets("/test/config.yaml");

      expect(result).toEqual(mockSecrets);
      expect(readFile).toHaveBeenCalledWith("/test/secrets.yaml", "utf-8");
    });

    it("should return null when file doesn't exist", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const result = await loadSecrets("/test/config.yaml");

      expect(result).toBeNull();
    });

    it("should throw on other errors", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("Permission denied"));

      await expect(loadSecrets("/test/config.yaml")).rejects.toThrow("Permission denied");
    });
  });

  describe("saveSecrets", () => {
    it("should save secrets to YAML file", async () => {
      const secrets = {
        discord: { token: "discord-123" },
        telegram: { token: "telegram-456" },
      };

      vi.mocked(stringify).mockReturnValue("yaml: content");
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(chmod).mockResolvedValue();

      await saveSecrets("/test/config.yaml", secrets);

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        "/test/secrets.yaml",
        "yaml: content",
        "utf-8"
      );
      expect(chmod).toHaveBeenCalledWith("/test/secrets.yaml", 0o600);
    });

    it("should ignore chmod errors", async () => {
      const secrets = { discord: { token: "test" } };

      vi.mocked(stringify).mockReturnValue("yaml: content");
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(chmod).mockRejectedValue(new Error("chmod failed"));

      // Should not throw despite chmod failure
      await expect(saveSecrets("/test/config.yaml", secrets)).resolves.toBeUndefined();
    });

    it("should create parent directories", async () => {
      const secrets = { discord: { token: "test" } };

      vi.mocked(stringify).mockReturnValue("yaml: content");
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(chmod).mockResolvedValue();

      await saveSecrets("/deep/nested/path/config.yaml", secrets);

      expect(mkdir).toHaveBeenCalledWith(
        "/deep/nested/path",
        { recursive: true }
      );
    });
  });
});
