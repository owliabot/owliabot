// src/agent/tools/builtin/help.ts
import type { ToolDefinition } from "../interface.js";
import type { ToolRegistry } from "../registry.js";

export function createHelpTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: "help",
    description: "List all available tools and their descriptions.",
    parameters: {
      type: "object",
      properties: {},
    },
    security: {
      level: "read",
    },
    async execute() {
      const tools = registry.getAll();
      const toolList = tools.map((t) => ({
        name: t.name,
        description: t.description,
        level: t.security.level,
      }));

      return {
        success: true,
        data: { tools: toolList },
      };
    },
  };
}
