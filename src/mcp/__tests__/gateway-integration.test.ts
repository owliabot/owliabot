import { describe, it, expect } from "vitest";
import { mcpGatewayConfigSchema } from "../../config/schema.js";

describe("MCP gateway config schema", () => {
  it("accepts undefined (MCP is optional)", () => {
    const result = mcpGatewayConfigSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it("parses a minimal config with presets", () => {
    const result = mcpGatewayConfigSchema.parse({
      presets: ["playwright"],
    });
    expect(result).toBeDefined();
    expect(result!.presets).toEqual(["playwright"]);
    expect(result!.autoStart).toBe(true);
    expect(result!.servers).toEqual([]);
  });

  it("parses explicit server config", () => {
    const result = mcpGatewayConfigSchema.parse({
      servers: [
        {
          name: "test-server",
          command: "node",
          args: ["server.js"],
          transport: "stdio",
        },
      ],
    });
    expect(result!.servers).toHaveLength(1);
    expect(result!.servers[0].name).toBe("test-server");
  });

  it("parses autoStart: false", () => {
    const result = mcpGatewayConfigSchema.parse({
      autoStart: false,
    });
    expect(result!.autoStart).toBe(false);
  });

  it("parses security overrides", () => {
    const result = mcpGatewayConfigSchema.parse({
      securityOverrides: {
        "playwright__browser_click": { level: "write" },
        "playwright__browser_screenshot": { level: "read" },
      },
    });
    expect(result!.securityOverrides).toBeDefined();
    expect(result!.securityOverrides!["playwright__browser_click"].level).toBe("write");
  });

  it("parses defaults", () => {
    const result = mcpGatewayConfigSchema.parse({
      defaults: {
        timeout: 60000,
        connectTimeout: 20000,
      },
    });
    expect(result!.defaults!.timeout).toBe(60000);
  });
});
