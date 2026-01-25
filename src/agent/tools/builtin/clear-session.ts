// src/agent/tools/builtin/clear-session.ts
import type { ToolDefinition } from "../interface.js";
import type { SessionManager, SessionKey } from "../../session.js";

export function createClearSessionTool(
  sessions: SessionManager
): ToolDefinition {
  return {
    name: "clear_session",
    description:
      "Clear the current conversation history. Use when the user wants to start fresh.",
    parameters: {
      type: "object",
      properties: {},
    },
    security: {
      level: "read", // Read because it only affects current session
    },
    async execute(_params, ctx) {
      await sessions.clear(ctx.sessionKey as SessionKey);
      return {
        success: true,
        data: { message: "Session cleared" },
      };
    },
  };
}
