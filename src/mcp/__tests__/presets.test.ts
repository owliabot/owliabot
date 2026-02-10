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

  it("uses system chromium when OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH is set", () => {
    const previous = process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
    process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH = "/usr/bin/chromium";

    try {
      const configs = expandMCPPresets(["playwright"]);
      expect(configs).toHaveLength(1);
      expect(configs[0].args).toContain("--browser");
      expect(configs[0].args).toContain("chrome");
      expect(configs[0].args).toContain("--executable-path");
      expect(configs[0].args).toContain("/usr/bin/chromium");
      expect(configs[0].env?.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH).toBe(
        "/usr/bin/chromium"
      );
      expect(configs[0].env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe("1");
    } finally {
      if (previous === undefined) {
        delete process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
      } else {
        process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH = previous;
      }
    }
  });

  it("adds --no-sandbox when PLAYWRIGHT_MCP_NO_SANDBOX is set", () => {
    const previous = process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
    process.env.PLAYWRIGHT_MCP_NO_SANDBOX = "1";

    try {
      const configs = expandMCPPresets(["playwright"]);
      expect(configs).toHaveLength(1);
      expect(configs[0].args).toContain("--no-sandbox");
    } finally {
      if (previous === undefined) {
        delete process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
      } else {
        process.env.PLAYWRIGHT_MCP_NO_SANDBOX = previous;
      }
    }
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
