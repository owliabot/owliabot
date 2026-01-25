// src/agent/tools/builtin/echo.ts
import type { ToolDefinition } from "../interface.js";

export const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo back the provided message. Useful for testing.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The message to echo back",
      },
    },
    required: ["message"],
  },
  security: {
    level: "read",
  },
  async execute(params) {
    const { message } = params as { message: string };
    return {
      success: true,
      data: { echoed: message },
    };
  },
};
