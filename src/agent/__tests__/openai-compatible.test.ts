import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
  }),
}));

import {
  openAICompatibleComplete,
  type OpenAICompatibleConfig,
} from "../openai-compatible.js";

describe("openAICompatibleComplete auth warnings", () => {
  beforeEach(() => {
    mockWarn.mockClear();
    // Mock fetch to return a valid response so the function doesn't throw on network
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "test",
          object: "chat.completion",
          created: 0,
          model: "test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("warns when authType is 'none' but apiKey is set", async () => {
    const config: OpenAICompatibleConfig = {
      baseUrl: "http://localhost:1234/v1",
      model: "test",
      apiKey: "sk-secret",
      authType: "none",
    };

    await openAICompatibleComplete(config, [{ role: "user", content: "hi" }]);

    expect(mockWarn).toHaveBeenCalledWith(
      "authType is 'none' but apiKey is set — apiKey will be ignored"
    );
  });

  it("warns when authType is 'header' but authHeader is empty", async () => {
    const config: OpenAICompatibleConfig = {
      baseUrl: "http://localhost:1234/v1",
      model: "test",
      apiKey: "sk-secret",
      authType: "header",
      authHeader: "",
    };

    await openAICompatibleComplete(config, [{ role: "user", content: "hi" }]);

    expect(mockWarn).toHaveBeenCalledWith(
      "authType is 'header' but authHeader is empty"
    );
  });

  it("warns when authType is 'header' but authHeader is missing", async () => {
    const config: OpenAICompatibleConfig = {
      baseUrl: "http://localhost:1234/v1",
      model: "test",
      apiKey: "sk-secret",
      authType: "header",
    };

    await openAICompatibleComplete(config, [{ role: "user", content: "hi" }]);

    expect(mockWarn).toHaveBeenCalledWith(
      "authType is 'header' but authHeader is empty"
    );
  });

  it("does not warn for valid bearer config", async () => {
    const config: OpenAICompatibleConfig = {
      baseUrl: "http://localhost:1234/v1",
      model: "test",
      apiKey: "sk-secret",
      authType: "bearer",
    };

    await openAICompatibleComplete(config, [{ role: "user", content: "hi" }]);

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
