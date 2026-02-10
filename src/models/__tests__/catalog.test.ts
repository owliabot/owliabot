import { describe, expect, it, vi, beforeEach } from "vitest";

import { listConfiguredModelCatalog } from "../catalog.js";
import * as piAi from "@mariozechner/pi-ai";

vi.mock("@mariozechner/pi-ai", () => ({
  getModels: vi.fn(),
}));

describe("listConfiguredModelCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists all pi-ai models for configured pi-ai providers", () => {
    vi.mocked(piAi.getModels).mockImplementation((provider: any) => {
      if (provider === "anthropic") {
        return [
          { provider: "anthropic", id: "claude-opus-4-5", name: "Opus" },
          { provider: "anthropic", id: "claude-sonnet-4-5", name: "Sonnet" },
        ] as any;
      }
      if (provider === "openai") {
        return [{ provider: "openai", id: "gpt-5.2", name: "GPT-5.2" }] as any;
      }
      throw new Error("unexpected provider");
    });

    const entries = listConfiguredModelCatalog({
      providers: [
        { id: "anthropic", model: "claude-opus-4-5", priority: 1 },
        { id: "openai", model: "gpt-5.2", priority: 2 },
      ],
    });

    expect(entries.map((e) => e.key)).toEqual([
      "anthropic/claude-opus-4-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5.2",
    ]);
  });

  it("falls back to the configured model for non-pi providers (e.g., openai-compatible)", () => {
    vi.mocked(piAi.getModels).mockImplementation(() => {
      throw new Error("should not be called");
    });

    const entries = listConfiguredModelCatalog({
      providers: [{ id: "openai-compatible", model: "llama3.2", baseUrl: "http://x", priority: 1 }],
    });

    expect(entries.map((e) => e.key)).toEqual(["openai-compatible/llama3.2"]);
  });

  it("filters by substring (case-insensitive) across key and name", () => {
    vi.mocked(piAi.getModels).mockImplementation((provider: any) => {
      if (provider === "openai") {
        return [
          { provider: "openai", id: "gpt-5.2", name: "GPT-5.2" },
          { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
        ] as any;
      }
      return [] as any;
    });

    const entries = listConfiguredModelCatalog({
      providers: [{ id: "openai", model: "gpt-4o", priority: 1 }],
      filter: "5.2",
    });

    expect(entries.map((e) => e.key)).toEqual(["openai/gpt-5.2"]);
  });
});

