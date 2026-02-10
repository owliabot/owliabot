import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadOAuthCredentials,
  saveOAuthCredentials,
  clearOAuthCredentials,
  getOAuthStatus,
  refreshOAuthCredentials,
  getAllOAuthStatus,
} from "../oauth.js";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as deviceCodeAuth from "../device-code-auth.js";
import { ensureOwliabotHomeEnv } from "../../utils/paths.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("../device-code-auth.js");
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function authDir(): string {
  return join(ensureOwliabotHomeEnv(), "auth");
}

describe("oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadOAuthCredentials", () => {
    it("should load valid credentials for openai-codex", async () => {
      const mockCredentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

      const result = await loadOAuthCredentials("openai-codex");

      expect(result).toEqual(mockCredentials);
      expect(readFile).toHaveBeenCalledWith(
        join(authDir(), "auth-openai-codex.json"),
        "utf-8"
      );
    });

    it("should return null when file doesn't exist", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const result = await loadOAuthCredentials("openai-codex");

      expect(result).toBeNull();
    });

    it("should auto-refresh expired openai-codex credentials", async () => {
      const expiredCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      const newTokens = {
        accessToken: "new_access",
        refreshToken: "refresh_token",
        idToken: "id_tok",
        expiresAt: Date.now() + 3600000,
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(expiredCredentials));
      vi.mocked(deviceCodeAuth.refreshDeviceCodeTokens).mockResolvedValue(newTokens);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await loadOAuthCredentials("openai-codex");

      expect(result).toEqual({
        access: "new_access",
        refresh: "refresh_token",
        idToken: "id_tok",
        expires: newTokens.expiresAt,
      });
      expect(deviceCodeAuth.refreshDeviceCodeTokens).toHaveBeenCalledWith("refresh_token");
    });

    it("should return null if refresh fails", async () => {
      const expiredCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(expiredCredentials));
      vi.mocked(deviceCodeAuth.refreshDeviceCodeTokens).mockRejectedValue(
        new Error("Refresh failed")
      );

      const result = await loadOAuthCredentials("openai-codex");

      expect(result).toBeNull();
    });
  });

  describe("saveOAuthCredentials", () => {
    it("should save openai-codex credentials", async () => {
      const credentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveOAuthCredentials(credentials, "openai-codex");

      expect(writeFile).toHaveBeenCalledWith(
        join(authDir(), "auth-openai-codex.json"),
        JSON.stringify(credentials, null, 2)
      );
    });
  });

  describe("clearOAuthCredentials", () => {
    it("should delete credentials file for openai-codex", async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      await clearOAuthCredentials("openai-codex");

      expect(unlink).toHaveBeenCalledWith(
        join(authDir(), "auth-openai-codex.json")
      );
    });

    it("should ignore ENOENT errors", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(unlink).mockRejectedValue(error);

      await expect(clearOAuthCredentials("openai-codex")).resolves.toBeUndefined();
    });
  });

  describe("getOAuthStatus", () => {
    it("should return authenticated status with valid credentials", async () => {
      const mockCredentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

      const status = await getOAuthStatus("openai-codex");

      expect(status.authenticated).toBe(true);
      expect(status.expiresAt).toBe(mockCredentials.expires);
      expect(status.email).toBe(mockCredentials.email);
    });

    it("should return unauthenticated status when no credentials", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const status = await getOAuthStatus("openai-codex");

      expect(status.authenticated).toBe(false);
    });
  });

  describe("getAllOAuthStatus", () => {
    it("should return status for openai-codex", async () => {
      const mockCredentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

      const statuses = await getAllOAuthStatus();

      expect(statuses["openai-codex"].authenticated).toBe(true);
      expect("anthropic" in statuses).toBe(false);
    });
  });

  describe("refreshOAuthCredentials", () => {
    it("should refresh and save openai-codex credentials", async () => {
      const oldCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
      };

      const newTokens = {
        accessToken: "new_access",
        refreshToken: "new_refresh",
        idToken: "new_id",
        expiresAt: Date.now() + 3600000,
      };

      vi.mocked(deviceCodeAuth.refreshDeviceCodeTokens).mockResolvedValue(newTokens);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await refreshOAuthCredentials(oldCredentials, "openai-codex");

      expect(result.access).toBe("new_access");
      expect(result.refresh).toBe("new_refresh");
      expect(deviceCodeAuth.refreshDeviceCodeTokens).toHaveBeenCalledWith("refresh_token");
      expect(writeFile).toHaveBeenCalled();
    });
  });
});
