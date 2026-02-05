import { ToolRegistry } from "../agent/tools/registry.js";
import {
  echoTool,
  createHelpTool,
  createClearSessionTool,
  createMemorySearchTool,
  createMemoryGetTool,
  createListFilesTool,
  createEditFileTool,
} from "../agent/tools/builtin/index.js";
import type { SessionStore } from "../agent/session-store.js";
import type { SessionTranscriptStore } from "../agent/session-transcript.js";
import { randomUUID } from "node:crypto";

function createNoopSessionStore(): SessionStore {
  const entries = new Map<string, { sessionId: string; updatedAt: number }>();

  return {
    async get(sessionKey) {
      return entries.get(sessionKey) ?? null;
    },

    async getOrCreate(sessionKey) {
      const existing = entries.get(sessionKey);
      if (existing) {
        const next = { ...existing, updatedAt: Date.now() };
        entries.set(sessionKey, next);
        return next as any;
      }
      const next = { sessionId: randomUUID(), updatedAt: Date.now() };
      entries.set(sessionKey, next);
      return next as any;
    },

    async rotate(sessionKey) {
      const next = { sessionId: randomUUID(), updatedAt: Date.now() };
      entries.set(sessionKey, next);
      return next as any;
    },

    async listKeys() {
      return [...entries.keys()];
    },
  };
}

function createNoopTranscriptStore(): SessionTranscriptStore {
  return {
    async append() {},
    async readAll() {
      return [];
    },
    async getHistory() {
      return [];
    },
    async clear() {},
  };
}

export async function createGatewayToolRegistry(workspacePath: string) {
  const tools = new ToolRegistry();

  const sessionStore = createNoopSessionStore();
  const transcripts = createNoopTranscriptStore();

  tools.register(echoTool);
  tools.register(createHelpTool(tools));
  tools.register(createClearSessionTool({ sessionStore, transcripts }));
  tools.register(createMemorySearchTool({ workspace: workspacePath }));
  tools.register(createMemoryGetTool({ workspace: workspacePath }));
  tools.register(createListFilesTool({ workspace: workspacePath }));
  tools.register(createEditFileTool({ workspace: workspacePath }));

  // Note: Markdown-based skills are injected into system prompts, not tool registries.
  // Skills initialization should happen at the gateway level where system prompts are built.

  return tools;
}
