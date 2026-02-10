import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

describe("MCP config", () => {
  it("defaults to undefined when mcp is omitted", () => {
    const minimal = {
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", priority: 1 }],
    };
    const parsed = configSchema.parse(minimal);

    expect(parsed.mcp).toBeUndefined();
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

    expect(parsed.mcp!.servers).toHaveLength(1);
    expect(parsed.mcp!.servers![0].name).toBe("custom-server");
  });

  it("allows empty servers list to disable MCP", () => {
    const config = {
      providers: [{ id: "anthropic", model: "claude-sonnet-4-5", priority: 1 }],
      mcp: { servers: [] },
    };
    const parsed = configSchema.parse(config);
    expect(parsed.mcp!.servers).toHaveLength(0);
  });
});
