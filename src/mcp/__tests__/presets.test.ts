import { describe, it, expect } from "vitest";
import { expandMCPPresets, getAvailablePresets, getDefaultSecurityOverrides } from "../presets.js";

describe("expandMCPPresets", () => {
  it("expands playwright preset with server config + security overrides", () => {
    const result = expandMCPPresets(["playwright"]);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe("playwright");
    expect(result.servers[0].command).toBe("npx");
    expect(result.servers[0].transport).toBe("stdio");
    expect(result.servers[0].args).toContain("--headless");

    // Preset security overrides must include screenshot/snapshot as read
    expect(result.securityOverrides["playwright__browser_take_screenshot"]).toEqual({ level: "read" });
    expect(result.securityOverrides["playwright__browser_snapshot"]).toEqual({ level: "read" });
    expect(result.securityOverrides["playwright__browser_navigate"]).toEqual({ level: "read" });
    // download should remain write
    expect(result.securityOverrides["playwright__browser_download"]).toEqual({ level: "write" });
  });

  it("uses system chromium when OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH is set", () => {
    const previous = process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
    process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH = "/usr/bin/chromium";

    try {
      const result = expandMCPPresets(["playwright"]);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].args).toContain("--browser");
      expect(result.servers[0].args).toContain("chrome");
      expect(result.servers[0].args).toContain("--executable-path");
      expect(result.servers[0].args).toContain("/usr/bin/chromium");
      expect(result.servers[0].env?.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH).toBe("/usr/bin/chromium");
      expect(result.servers[0].env?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe("1");
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
      const result = expandMCPPresets(["playwright"]);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].args).toContain("--no-sandbox");
    } finally {
      if (previous === undefined) {
        delete process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
      } else {
        process.env.PLAYWRIGHT_MCP_NO_SANDBOX = previous;
      }
    }
  });

  it("skips unknown presets without throwing", () => {
    const result = expandMCPPresets(["nonexistent"]);
    expect(result.servers).toHaveLength(0);
    expect(Object.keys(result.securityOverrides)).toHaveLength(0);
  });

  it("handles mixed known and unknown presets", () => {
    const result = expandMCPPresets(["playwright", "unknown", "playwright"]);
    expect(result.servers).toHaveLength(1);
    // Security overrides should still be populated
    expect(result.securityOverrides["playwright__browser_take_screenshot"]).toBeDefined();
  });

  it("returns empty for empty input", () => {
    const result = expandMCPPresets([]);
    expect(result.servers).toEqual([]);
    expect(result.securityOverrides).toEqual({});
  });
});

describe("getDefaultSecurityOverrides", () => {
  it("returns playwright overrides for 'playwright' server name", () => {
    const overrides = getDefaultSecurityOverrides("playwright");
    expect(overrides["playwright__browser_take_screenshot"]).toEqual({ level: "read" });
    expect(overrides["playwright__browser_snapshot"]).toEqual({ level: "read" });
    expect(overrides["playwright__browser_download"]).toEqual({ level: "write" });
  });

  it("returns empty object for unknown server name", () => {
    expect(getDefaultSecurityOverrides("unknown")).toEqual({});
  });
});

describe("getAvailablePresets", () => {
  it("includes playwright", () => {
    expect(getAvailablePresets()).toContain("playwright");
  });
});
