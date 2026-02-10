import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

describe("MCP default preset", () => {
  it("defaults to Playwright MCP server when mcp is omitted", () => {
    const minimal = {
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", priority: 1 }],
    };
    const parsed = configSchema.parse(minimal);

    expect(parsed.mcp).toBeDefined();
    expect(parsed.mcp.servers).toHaveLength(1);
    expect(parsed.mcp.servers[0].name).toBe("playwright");
    expect(parsed.mcp.servers[0].command).toBe("npx");
    expect(parsed.mcp.servers[0].transport).toBe("stdio");
  });

  it("uses user-provided mcp config when explicitly set", () => {
    const config = {
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", priority: 1 }],
      mcp: {
        servers: [
          { name: "custom-server", command: "my-cmd", args: ["--flag"], transport: "stdio" as const },
        ],
      },
    };
    const parsed = configSchema.parse(config);

    expect(parsed.mcp.servers).toHaveLength(1);
    expect(parsed.mcp.servers[0].name).toBe("custom-server");
  });

  it("allows empty servers list to disable MCP", () => {
    const config = {
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", priority: 1 }],
      mcp: { servers: [] },
    };
    const parsed = configSchema.parse(config);
    expect(parsed.mcp.servers).toHaveLength(0);
  });
});
