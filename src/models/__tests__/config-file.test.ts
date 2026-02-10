import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { updateAppConfigYamlPrimaryModel } from "../config-file.js";

describe("updateAppConfigYamlPrimaryModel", () => {
  it("moves selected provider to priority=1, updates model, and rewrites priorities sequentially", () => {
    const input = `
workspace: \${OWLIABOT_HOME}/workspace
providers:
  - id: anthropic
    model: claude-opus-4-5
    apiKey: secrets
    priority: 1
  - id: openai
    model: gpt-4o
    apiKey: env
    priority: 2
`;

    const output = updateAppConfigYamlPrimaryModel(input, { provider: "openai", model: "gpt-5.2" });

    const doc = parse(output) as any;
    expect(doc.workspace).toBe("${OWLIABOT_HOME}/workspace");

    expect(doc.providers).toEqual([
      expect.objectContaining({
        id: "openai",
        model: "gpt-5.2",
        apiKey: "env",
        priority: 1,
      }),
      expect.objectContaining({
        id: "anthropic",
        model: "claude-opus-4-5",
        apiKey: "secrets",
        priority: 2,
      }),
    ]);
  });

  it("throws when provider is not present in providers[]", () => {
    const input = `
providers:
  - id: anthropic
    model: claude-opus-4-5
    priority: 1
`;

    expect(() => updateAppConfigYamlPrimaryModel(input, { provider: "openai", model: "gpt-5.2" })).toThrow(
      "Override provider not found",
    );
  });
});

