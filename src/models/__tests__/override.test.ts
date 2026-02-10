import { describe, expect, it } from "vitest";

import { applyPrimaryModelRefOverride } from "../override.js";

describe("applyPrimaryModelRefOverride", () => {
  it("moves the selected provider to primary and rewrites priorities sequentially", () => {
    const providers = [
      { id: "anthropic", model: "claude-opus-4-5", apiKey: "k1", priority: 1 },
      { id: "openai", model: "gpt-4o", apiKey: "k2", priority: 2 },
      { id: "openai-codex", model: "gpt-5.2-codex", apiKey: "oauth", priority: 3 },
    ];

    const next = applyPrimaryModelRefOverride(providers, {
      provider: "openai",
      model: "gpt-5.2",
    });

    expect(next.map((p) => `${p.priority}:${p.id}/${p.model}`)).toEqual([
      "1:openai/gpt-5.2",
      "2:anthropic/claude-opus-4-5",
      "3:openai-codex/gpt-5.2-codex",
    ]);

    // Preserve provider-specific fields
    expect(next[0]).toMatchObject({ apiKey: "k2" });
  });

  it("updates the model id even if the provider is already primary", () => {
    const providers = [
      { id: "openai", model: "gpt-4o", apiKey: "k2", priority: 1 },
      { id: "anthropic", model: "claude-opus-4-5", apiKey: "k1", priority: 2 },
    ];

    const next = applyPrimaryModelRefOverride(providers, {
      provider: "openai",
      model: "gpt-5.2",
    });

    expect(next.map((p) => `${p.priority}:${p.id}/${p.model}`)).toEqual([
      "1:openai/gpt-5.2",
      "2:anthropic/claude-opus-4-5",
    ]);
  });

  it("throws when the provider does not exist in the chain", () => {
    const providers = [{ id: "anthropic", model: "claude-opus-4-5", apiKey: "k1", priority: 1 }];

    expect(() =>
      applyPrimaryModelRefOverride(providers, { provider: "openai", model: "gpt-5.2" }),
    ).toThrow(/provider/i);
  });
});

