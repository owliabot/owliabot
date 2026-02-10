import { describe, expect, it } from "vitest";

import { formatModelRef, parseModelRef } from "../ref.js";

describe("parseModelRef", () => {
  it("parses provider/model with a single slash", () => {
    expect(parseModelRef("openai/gpt-5.2")).toEqual({ provider: "openai", model: "gpt-5.2" });
  });

  it("parses provider/model where model contains additional slashes (e.g., openrouter)", () => {
    expect(parseModelRef("openrouter/moonshotai/kimi-k2")).toEqual({
      provider: "openrouter",
      model: "moonshotai/kimi-k2",
    });
  });

  it("returns null for invalid values", () => {
    expect(parseModelRef("")).toBeNull();
    expect(parseModelRef("openai")).toBeNull();
    expect(parseModelRef("openai/")).toBeNull();
    expect(parseModelRef("/gpt-5.2")).toBeNull();
  });
});

describe("formatModelRef", () => {
  it("formats provider/model", () => {
    expect(formatModelRef({ provider: "openai", model: "gpt-5.2" })).toBe("openai/gpt-5.2");
  });
});

