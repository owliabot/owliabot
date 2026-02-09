/**
 * @deprecated Phase 1 Gateway Unification — this module is kept for backward compatibility only.
 *
 * When the main gateway starts the HTTP server, it now injects shared resources
 * (toolRegistry, sessionStore, transcripts) directly. This fallback is only used
 * when startGatewayHttp is called without those resources (e.g., in tests).
 *
 * This file will be removed in Phase 2 when the HTTP server no longer supports
 * standalone operation.
 *
 * @see docs/plans/gateway-unification.md
 */

import { ToolRegistry } from "../../agent/tools/registry.js";
import {
  createBuiltinTools,
  createHelpTool,
  type BuiltinToolsOptions,
  type ToolPolicy,
} from "../../agent/tools/builtin/index.js";
import type { SessionStore } from "../../agent/session-store.js";
import type { SessionTranscriptStore } from "../../agent/session-transcript.js";
import { randomUUID } from "node:crypto";

/**
 * Options for creating the gateway tool registry
 * @deprecated See module-level deprecation notice
 */
export interface GatewayToolRegistryOptions {
  /** Workspace directory path */
  workspace: string;
  /** Tool configuration */
  tools?: {
    /** Enable write tools (edit_file). Default: false */
    allowWrite?: boolean;
    /** Policy for filtering tools */
    policy?: ToolPolicy;
  };
}

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

/**
 * Create gateway tool registry with proper config handling.
 *
 * @deprecated Phase 1 Gateway Unification — prefer injecting shared toolRegistry
 * from main gateway instead of creating a duplicate registry here.
 *
 * @param workspacePathOrOpts - Workspace path (string) for backwards compat, or full options
 * @returns ToolRegistry instance
 */
export async function createGatewayToolRegistry(
  workspacePathOrOpts: string | GatewayToolRegistryOptions
): Promise<ToolRegistry> {
  const opts: GatewayToolRegistryOptions =
    typeof workspacePathOrOpts === "string"
      ? { workspace: workspacePathOrOpts }
      : workspacePathOrOpts;

  const { workspace: workspacePath, tools: toolsConfig } = opts;

  const tools = new ToolRegistry();

  const sessionStore = createNoopSessionStore();
  const transcripts = createNoopTranscriptStore();

  // Use createBuiltinTools which respects allowWrite and policy
  const builtinOpts: BuiltinToolsOptions = {
    workspace: workspacePath,
    sessionStore,
    transcripts,
    tools: toolsConfig,
  };

  for (const tool of createBuiltinTools(builtinOpts)) {
    tools.register(tool);
  }

  // Register help tool last (needs registry reference)
  tools.register(createHelpTool(tools));

  // Note: Markdown-based skills are injected into system prompts, not tool registries.
  // Skills initialization should happen at the gateway level where system prompts are built.

  return tools;
}
