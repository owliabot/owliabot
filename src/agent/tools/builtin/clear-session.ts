// src/agent/tools/builtin/clear-session.ts
import type { ToolDefinition } from "../interface.js";
import type { SessionStore } from "../../session-store.js";
import type { SessionTranscriptStore } from "../../session-transcript.js";

export function createClearSessionTool(options: {
  sessionStore: SessionStore;
  transcripts: SessionTranscriptStore;
}): ToolDefinition {
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
      const { sessionStore, transcripts } = options;

      const existing = await sessionStore.get(ctx.sessionKey);
      const rotated = await sessionStore.rotate(ctx.sessionKey);

      // Clear transcripts for both the old + the new sessionId.
      // (New will usually be empty, but we ensure it.)
      if (existing?.sessionId) {
        await transcripts.clear(existing.sessionId);
      }
      await transcripts.clear(rotated.sessionId);

      return {
        success: true,
        data: { message: "Session cleared", sessionId: rotated.sessionId },
      };
    },
  };
}
