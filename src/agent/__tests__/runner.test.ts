import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLLM, callWithFailover, HTTPError, TimeoutError } from "../runner.js";
import * as piAi from "@mariozechner/pi-ai";
import * as oauth from "../../auth/oauth.js";

vi.mock("@mariozechner/pi-ai");
vi.mock("../../auth/oauth.js");
vi.mock("../models.js", () => {
  const resolveModel = vi.fn((config: { provider?: string; model: string }) => {
    const aliasMap: Record<
      string,
      { provider: string; id: string; api: string }
    > = {
      sonnet: { provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" },
      opus: { provider: "anthropic", id: "claude-opus-4-5", api: "anthropic-messages" },
      haiku: { provider: "anthropic", id: "claude-haiku-4-5", api: "anthropic-messages" },
      "claude-sonnet-4-5": {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        api: "anthropic-messages",
      },
      "claude-opus-4-5": {
        provider: "anthropic",
        id: "claude-opus-4-5",
        api: "anthropic-messages",
      },
      "gpt-4o": { provider: "openai", id: "gpt-4o", api: "openai" },
      "gpt-4o-mini": { provider: "openai", id: "gpt-4o-mini", api: "openai" },
      "o1": { provider: "openai", id: "o1", api: "openai" },
      "o1-mini": { provider: "openai", id: "o1-mini", api: "openai" },
      "gemini": { provider: "google", id: "gemini-2.5-pro", api: "google" },
      "gemini-2.5-pro": { provider: "google", id: "gemini-2.5-pro", api: "google" },
      "gemini-2.5-flash": { provider: "google", id: "gemini-2.5-flash", api: "google" },
    };

    if (aliasMap[config.model]) {
      return aliasMap[config.model];
    }

    if (config.model.includes("/")) {
      const [provider, id] = config.model.split("/", 2);
      return {
        provider,
        id,
        api: provider === "openai" ? "openai" : provider === "google" ? "google" : "anthropic-messages",
      };
    }

    const provider = config.provider ?? "anthropic";
    return {
      provider,
      id: config.model,
      api: provider === "openai" ? "openai" : provider === "google" ? "google" : "anthropic-messages",
    };
  });

  return { resolveModel };
});
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  describe("runLLM", () => {
    it("should call LLM and return response", async () => {
      const mockResponse = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Hello!" }],
        api: "anthropic-messages" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 150,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };

      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      vi.mocked(piAi.complete).mockResolvedValue(mockResponse as any);

      const messages = [
        { role: "user" as const, content: "Hi", timestamp: Date.now() },
      ];

      const result = await runLLM({ model: "sonnet" }, messages);

      expect(result.content).toBe("Hello!");
      expect(result.usage.promptTokens).toBe(100);
      expect(result.usage.completionTokens).toBe(50);
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-5");
    });

    it("should handle tool calls in response", async () => {
      const mockResponse = {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Let me check that." },
          {
            type: "toolCall" as const,
            id: "call_123",
            name: "echo",
            arguments: { message: "test" },
          },
        ],
        api: "anthropic-messages" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 150,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse" as const,
        timestamp: Date.now(),
      };

      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      vi.mocked(piAi.complete).mockResolvedValue(mockResponse as any);

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      const result = await runLLM({ model: "sonnet" }, messages);

      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe("echo");
      expect(result.toolCalls![0].id).toBe("call_123");
    });

    it("should handle truncated responses", async () => {
      const mockResponse = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Response..." }],
        api: "anthropic-messages" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 100,
          output: 4096,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 4196,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "length" as const,
        timestamp: Date.now(),
      };

      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      vi.mocked(piAi.complete).mockResolvedValue(mockResponse as any);

      const messages = [
        { role: "user" as const, content: "Long query", timestamp: Date.now() },
      ];

      const result = await runLLM({ model: "sonnet" }, messages);

      expect(result.truncated).toBe(true);
    });

    it("should throw on error stop reason", async () => {
      const mockResponse = {
        role: "assistant" as const,
        content: [],
        api: "anthropic-messages" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error" as const,
        errorMessage: "API error",
        timestamp: Date.now(),
      };

      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      vi.mocked(piAi.complete).mockResolvedValue(mockResponse as any);

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      await expect(runLLM({ model: "sonnet" }, messages)).rejects.toThrow("API error");
    });

    it("should throw for anthropic when no key available (OAuth deprecated, use setup-token)", async () => {
      // Anthropic no longer uses OAuth - it uses setup-token which is treated as an API key
      // When no key is available at all, it should throw with helpful message
      delete process.env.ANTHROPIC_API_KEY;

      vi.mocked(piAi.getEnvApiKey).mockReturnValue(undefined);
      // OAuth is not called for anthropic anymore - only openai-codex uses OAuth
      vi.mocked(oauth.loadOAuthCredentials).mockResolvedValue(null);

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      await expect(runLLM({ model: "claude-sonnet-4-5" }, messages)).rejects.toThrow(
        /No API key found for anthropic/
      );
    });

    it("should use OAuth credentials for openai-codex when env key not available", async () => {
      delete process.env.OPENAI_API_KEY;

      const mockCredentials = { access_token: "oauth-token", refresh_token: "refresh" };
      vi.mocked(piAi.getEnvApiKey).mockReturnValue(undefined);
      vi.mocked(oauth.loadOAuthCredentials).mockResolvedValue(mockCredentials as any);
      vi.mocked(piAi.getOAuthApiKey).mockResolvedValue({
        apiKey: "oauth-key",
        newCredentials: mockCredentials,
      } as any);

      const mockResponse = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "OAuth works!" }],
        api: "openai" as const,
        provider: "openai",
        model: "gpt-5.2",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };

      vi.mocked(piAi.complete).mockResolvedValue(mockResponse as any);

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      const result = await runLLM({ model: "openai-codex/gpt-5.2" }, messages);

      expect(result.content).toBe("OAuth works!");
      expect(oauth.loadOAuthCredentials).toHaveBeenCalledWith("openai-codex");
    });
  });

  describe("callWithFailover", () => {
    it("should try providers in priority order", async () => {
      const mockResponse = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Success" }],
        api: "anthropic-messages" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };

      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      vi.mocked(piAi.complete).mockResolvedValue(mockResponse as any);

      const providers = [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "key1", priority: 1 },
        { id: "openai", model: "gpt-4o", apiKey: "key2", priority: 2 },
      ];

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      const result = await callWithFailover(providers, messages);

      expect(result.content).toBe("Success");
    });

    it("should failover to next provider on error", async () => {
      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      
      // First call fails, second succeeds
      vi.mocked(piAi.complete)
        .mockRejectedValueOnce(new Error("First provider failed"))
        .mockResolvedValueOnce({
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Failover success" }],
          api: "openai" as const,
          provider: "openai",
          model: "gpt-4o",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop" as const,
          timestamp: Date.now(),
        } as any);

      const providers = [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "key1", priority: 1 },
        { id: "openai", model: "gpt-4o", apiKey: "key2", priority: 2 },
      ];

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      const result = await callWithFailover(providers, messages);

      expect(result.content).toBe("Failover success");
      expect(result.provider).toBe("openai");
    });

    it("should throw last error when all providers fail", async () => {
      vi.mocked(piAi.getEnvApiKey).mockReturnValue("test-key");
      vi.mocked(piAi.complete).mockRejectedValue(new Error("All failed"));

      const providers = [
        { id: "anthropic", model: "claude-sonnet-4-5", apiKey: "key1", priority: 1 },
        { id: "openai", model: "gpt-4o", apiKey: "key2", priority: 2 },
      ];

      const messages = [
        { role: "user" as const, content: "Test", timestamp: Date.now() },
      ];

      await expect(callWithFailover(providers, messages)).rejects.toThrow("All failed");
    });
  });

  describe("error classes", () => {
    it("HTTPError should have status and message", () => {
      const error = new HTTPError(404, "Not found");
      expect(error.status).toBe(404);
      expect(error.message).toBe("Not found");
      expect(error.name).toBe("HTTPError");
    });

    it("TimeoutError should have proper name", () => {
      const error = new TimeoutError("Request timeout");
      expect(error.message).toBe("Request timeout");
      expect(error.name).toBe("TimeoutError");
    });
  });
});
