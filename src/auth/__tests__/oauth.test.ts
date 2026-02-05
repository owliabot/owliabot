import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadOAuthCredentials,
  saveOAuthCredentials,
  clearOAuthCredentials,
  getOAuthStatus,
  refreshOAuthCredentials,
  getAllOAuthStatus,
  type SupportedOAuthProvider,
} from "../oauth.js";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as piAi from "@mariozechner/pi-ai";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("@mariozechner/pi-ai");
vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const AUTH_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".owliabot",
  "auth"
);

describe("oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadOAuthCredentials", () => {
    it("should load valid credentials for anthropic", async () => {
      const mockCredentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

      const result = await loadOAuthCredentials("anthropic");

      expect(result).toEqual(mockCredentials);
      expect(readFile).toHaveBeenCalledWith(
        join(AUTH_DIR, "auth-anthropic.json"),
        "utf-8"
      );
    });

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
        join(AUTH_DIR, "auth-openai-codex.json"),
        "utf-8"
      );
    });

    it("should return null when file doesn't exist", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const result = await loadOAuthCredentials("anthropic");

      expect(result).toBeNull();
    });

    it("should auto-refresh expired credentials", async () => {
      const expiredCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      const newCredentials = {
        access: "new_access",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(expiredCredentials));
      vi.mocked(piAi.refreshAnthropicToken).mockResolvedValue(
        newCredentials as any
      );
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await loadOAuthCredentials("anthropic");

      expect(result).toEqual(newCredentials);
      expect(piAi.refreshAnthropicToken).toHaveBeenCalled();
    });

    it("should auto-refresh expired openai-codex credentials", async () => {
      const expiredCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      const newCredentials = {
        access: "new_access",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(expiredCredentials));
      vi.mocked(piAi.refreshOpenAICodexToken).mockResolvedValue(
        newCredentials as any
      );
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await loadOAuthCredentials("openai-codex");

      expect(result).toEqual(newCredentials);
      expect(piAi.refreshOpenAICodexToken).toHaveBeenCalled();
    });

    it("should return null if refresh fails", async () => {
      const expiredCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(expiredCredentials));
      vi.mocked(piAi.refreshAnthropicToken).mockRejectedValue(
        new Error("Refresh failed")
      );

      const result = await loadOAuthCredentials("anthropic");

      expect(result).toBeNull();
    });
  });

  describe("saveOAuthCredentials", () => {
    it("should save credentials to provider-specific file", async () => {
      const credentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveOAuthCredentials(credentials as any, "anthropic");

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        join(AUTH_DIR, "auth-anthropic.json"),
        JSON.stringify(credentials, null, 2)
      );
    });

    it("should save openai-codex credentials", async () => {
      const credentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveOAuthCredentials(credentials as any, "openai-codex");

      expect(writeFile).toHaveBeenCalledWith(
        join(AUTH_DIR, "auth-openai-codex.json"),
        JSON.stringify(credentials, null, 2)
      );
    });
  });

  describe("clearOAuthCredentials", () => {
    it("should delete credentials file for anthropic", async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      await clearOAuthCredentials("anthropic");

      expect(unlink).toHaveBeenCalledWith(join(AUTH_DIR, "auth-anthropic.json"));
      expect(unlink).toHaveBeenCalledTimes(1);
    });

    it("should delete credentials file for openai-codex", async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      await clearOAuthCredentials("openai-codex");

      expect(unlink).toHaveBeenCalledWith(
        join(AUTH_DIR, "auth-openai-codex.json")
      );
      expect(unlink).toHaveBeenCalledTimes(1);
    });

    it("should ignore ENOENT errors", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(unlink).mockRejectedValue(error);

      // Should not throw
      await expect(clearOAuthCredentials("anthropic")).resolves.toBeUndefined();
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

      const status = await getOAuthStatus("anthropic");

      expect(status.authenticated).toBe(true);
      expect(status.expiresAt).toBe(mockCredentials.expires);
      expect(status.email).toBe(mockCredentials.email);
    });

    it("should return unauthenticated status when no credentials", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const status = await getOAuthStatus("anthropic");

      expect(status.authenticated).toBe(false);
      expect(status.expiresAt).toBeUndefined();
      expect(status.email).toBeUndefined();
    });
  });

  describe("getAllOAuthStatus", () => {
    it("should return status for all providers", async () => {
      const mockCredentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

      const statuses = await getAllOAuthStatus();

      expect(statuses.anthropic.authenticated).toBe(true);
      expect(statuses["openai-codex"].authenticated).toBe(true);
    });
  });

  describe("refreshOAuthCredentials", () => {
    it("should refresh and save anthropic credentials", async () => {
      const oldCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      const newCredentials = {
        access: "new_access",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(piAi.refreshAnthropicToken).mockResolvedValue(newCredentials as any);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await refreshOAuthCredentials(oldCredentials as any, "anthropic");

      expect(result).toEqual(newCredentials);
      expect(piAi.refreshAnthropicToken).toHaveBeenCalledWith(oldCredentials.refresh);
      expect(writeFile).toHaveBeenCalled();
    });

    it("should refresh and save openai-codex credentials", async () => {
      const oldCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      const newCredentials = {
        access: "new_access",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(piAi.refreshOpenAICodexToken).mockResolvedValue(
        newCredentials as any
      );
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await refreshOAuthCredentials(oldCredentials as any, "openai-codex");

      expect(result).toEqual(newCredentials);
      expect(piAi.refreshOpenAICodexToken).toHaveBeenCalledWith(oldCredentials.refresh);
      expect(writeFile).toHaveBeenCalled();
    });
  });
});
