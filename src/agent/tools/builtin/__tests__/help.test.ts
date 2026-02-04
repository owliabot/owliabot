import { describe, it, expect, beforeEach } from "vitest";
import { createHelpTool } from "../help.js";
import { ToolRegistry } from "../../registry.js";
import type { ToolDefinition } from "../../interface.js";

describe("help tool", () => {
  let registry: ToolRegistry;
  let helpTool: ToolDefinition;

  beforeEach(() => {
    registry = new ToolRegistry();
    helpTool = createHelpTool(registry);
  });

  it("should list all registered tools", async () => {
    const mockTool1: ToolDefinition = {
      name: "tool1",
      description: "First tool",
      parameters: { type: "object", properties: {} },
      security: { level: "read" },
      execute: async () => ({ success: true }),
    };

    const mockTool2: ToolDefinition = {
      name: "tool2",
      description: "Second tool",
      parameters: { type: "object", properties: {} },
      security: { level: "write" },
      execute: async () => ({ success: true }),
    };

    registry.register(mockTool1);
    registry.register(mockTool2);

    const result = await helpTool.execute({}, {} as any);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const tools = (result.data as any).tools;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      name: "tool1",
      description: "First tool",
      level: "read",
    });
    expect(tools[1]).toEqual({
      name: "tool2",
      description: "Second tool",
      level: "write",
    });
  });

  it("should return empty list when no tools registered", async () => {
    const result = await helpTool.execute({}, {} as any);

    expect(result.success).toBe(true);
    const tools = (result.data as any).tools;
    expect(tools).toEqual([]);
  });

  it("should have correct metadata", () => {
    expect(helpTool.name).toBe("help");
    expect(helpTool.description).toContain("List all available tools");
    expect(helpTool.security.level).toBe("read");
  });

  it("should include security level in tool list", async () => {
    const signTool: ToolDefinition = {
      name: "sign_transaction",
      description: "Sign a transaction",
      parameters: { type: "object", properties: {} },
      security: { level: "sign" },
      execute: async () => ({ success: true }),
    };

    registry.register(signTool);

    const result = await helpTool.execute({}, {} as any);
    const tools = (result.data as any).tools;

    expect(tools[0].level).toBe("sign");
  });
});
