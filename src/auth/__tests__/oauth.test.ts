import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadOAuthCredentials,
  saveOAuthCredentials,
  clearOAuthCredentials,
  getOAuthStatus,
  refreshOAuthCredentials,
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

describe("oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadOAuthCredentials", () => {
    it("should load valid credentials", async () => {
      const mockCredentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockCredentials));

      const result = await loadOAuthCredentials();

      expect(result).toEqual(mockCredentials);
    });

    it("should return null when file doesn't exist", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const result = await loadOAuthCredentials();

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
      vi.mocked(piAi.refreshAnthropicToken).mockResolvedValue(newCredentials as any);
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      const result = await loadOAuthCredentials();

      expect(result).toEqual(newCredentials);
      expect(piAi.refreshAnthropicToken).toHaveBeenCalled();
    });

    it("should return null if refresh fails", async () => {
      const expiredCredentials = {
        access: "old_access",
        refresh: "refresh_token",
        expires: Date.now() - 1000,
        email: "test@example.com",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(expiredCredentials));
      vi.mocked(piAi.refreshAnthropicToken).mockRejectedValue(new Error("Refresh failed"));

      const result = await loadOAuthCredentials();

      expect(result).toBeNull();
    });
  });

  describe("saveOAuthCredentials", () => {
    it("should save credentials to file", async () => {
      const credentials = {
        access: "access_token",
        refresh: "refresh_token",
        expires: Date.now() + 3600000,
        email: "test@example.com",
      };

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue();

      await saveOAuthCredentials(credentials as any);

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("auth.json"),
        JSON.stringify(credentials, null, 2)
      );
    });
  });

  describe("clearOAuthCredentials", () => {
    it("should delete credentials file", async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);
      const expectedPath = join(
        process.env.HOME ?? process.env.USERPROFILE ?? ".",
        ".owliabot",
        "auth.json"
      );
      await clearOAuthCredentials();

      expect(unlink).toHaveBeenCalledWith(expectedPath);
    });

    it("should ignore ENOENT errors", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(unlink).mockRejectedValue(error);
      const expectedPath = join(
        process.env.HOME ?? process.env.USERPROFILE ?? ".",
        ".owliabot",
        "auth.json"
      );

      // Should not throw
      await expect(clearOAuthCredentials()).resolves.toBeUndefined();
      expect(unlink).toHaveBeenCalledWith(expectedPath);
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

      const status = await getOAuthStatus();

      expect(status.authenticated).toBe(true);
      expect(status.expiresAt).toBe(mockCredentials.expires);
      expect(status.email).toBe(mockCredentials.email);
    });

    it("should return unauthenticated status when no credentials", async () => {
      const error: any = new Error("ENOENT");
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const status = await getOAuthStatus();

      expect(status.authenticated).toBe(false);
      expect(status.expiresAt).toBeUndefined();
      expect(status.email).toBeUndefined();
    });
  });

  describe("refreshOAuthCredentials", () => {
    it("should refresh and save credentials", async () => {
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

      const result = await refreshOAuthCredentials(oldCredentials as any);

      expect(result).toEqual(newCredentials);
      expect(piAi.refreshAnthropicToken).toHaveBeenCalledWith(oldCredentials.refresh);
      expect(writeFile).toHaveBeenCalled();
    });
  });
});
