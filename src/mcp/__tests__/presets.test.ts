import { describe, it, expect } from "vitest";
import { expandMCPPresets, getAvailablePresets } from "../presets.js";

describe("expandMCPPresets", () => {
  it("expands playwright preset to a valid server config", () => {
    const configs = expandMCPPresets(["playwright"]);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("playwright");
    expect(configs[0].command).toBe("npx");
    expect(configs[0].transport).toBe("stdio");
    expect(configs[0].args).toContain("--headless");
  });

  it("skips unknown presets without throwing", () => {
    const configs = expandMCPPresets(["nonexistent"]);
    expect(configs).toHaveLength(0);
  });

  it("handles mixed known and unknown presets", () => {
    const configs = expandMCPPresets(["playwright", "unknown", "playwright"]);
    // Duplicates are deduplicated by name
    expect(configs).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(expandMCPPresets([])).toEqual([]);
  });
});

describe("getAvailablePresets", () => {
  it("includes playwright", () => {
    expect(getAvailablePresets()).toContain("playwright");
  });
});
