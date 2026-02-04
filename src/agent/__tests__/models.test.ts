import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveModel, getAvailableModels, validateAliases } from "../models.js";
import * as piAi from "@mariozechner/pi-ai";

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("should resolve model aliases", () => {
      const mockModel = { provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" };
      vi.mocked(piAi.getModel).mockReturnValue(mockModel as any);

      const result = resolveModel({ model: "sonnet" });
      
      expect(piAi.getModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-5");
      expect(result).toEqual(mockModel);
    });

    it("should resolve provider/model format", () => {
      const mockModel = { provider: "openai", id: "gpt-4o", api: "openai" };
      vi.mocked(piAi.getModel).mockReturnValue(mockModel as any);

      const result = resolveModel({ model: "openai/gpt-4o" });
      
      expect(piAi.getModel).toHaveBeenCalledWith("openai", "gpt-4o");
      expect(result).toEqual(mockModel);
    });

    it("should use explicit provider", () => {
      const mockModel = { provider: "google", id: "gemini-2.5-pro", api: "google" };
      vi.mocked(piAi.getModel).mockReturnValue(mockModel as any);

      const result = resolveModel({ provider: "google", model: "gemini-2.5-pro" });
      
      expect(piAi.getModel).toHaveBeenCalledWith("google", "gemini-2.5-pro");
      expect(result).toEqual(mockModel);
    });

    it("should default to anthropic provider", () => {
      const mockModel = { provider: "anthropic", id: "claude-3-5-haiku", api: "anthropic-messages" };
      vi.mocked(piAi.getModel).mockReturnValue(mockModel as any);

      const result = resolveModel({ model: "claude-3-5-haiku" });
      
      expect(piAi.getModel).toHaveBeenCalledWith("anthropic", "claude-3-5-haiku");
      expect(result).toEqual(mockModel);
    });

    it("should throw error for unknown model", () => {
      vi.mocked(piAi.getModel).mockReturnValue(null as any);
      vi.mocked(piAi.getModels).mockReturnValue([]);

      expect(() => resolveModel({ model: "unknown-model" })).toThrow("Unknown model");
    });
  });

  describe("getAvailableModels", () => {
    it("should return models for a provider", () => {
      const mockModels = [
        { provider: "anthropic", id: "claude-sonnet-4-5" },
        { provider: "anthropic", id: "claude-opus-4-5" },
      ];
      vi.mocked(piAi.getModels).mockReturnValue(mockModels as any);

      const result = getAvailableModels("anthropic");
      
      expect(result).toEqual(mockModels);
    });

    it("should return empty array on error", () => {
      vi.mocked(piAi.getModels).mockImplementation(() => {
        throw new Error("Provider not found");
      });

      const result = getAvailableModels("invalid");
      
      expect(result).toEqual([]);
    });
  });

  describe("validateAliases", () => {
    it("should return valid when all aliases work", () => {
      const mockModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
      vi.mocked(piAi.getModel).mockReturnValue(mockModel as any);

      const result = validateAliases();
      
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should collect errors for invalid aliases", () => {
      vi.mocked(piAi.getModel).mockReturnValue(null as any);
      vi.mocked(piAi.getModels).mockReturnValue([]);

      const result = validateAliases();
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
