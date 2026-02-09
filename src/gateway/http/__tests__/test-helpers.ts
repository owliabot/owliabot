/**
 * Test helpers for HTTP Gateway tests
 *
 * Provides mock implementations of shared resources required by Phase 2.
 */

import { ToolRegistry } from "../../../agent/tools/registry.js";
import type { SessionStore } from "../../../agent/session-store.js";
import type { SessionTranscriptStore } from "../../../agent/session-transcript.js";
import type { GatewayHttpConfig } from "../server.js";
import { randomUUID } from "node:crypto";

/**
 * Default test configuration
 */
export const testConfig: GatewayHttpConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "gw",
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

/**
 * Create a mock ToolRegistry with optional custom tools
 */
export function createMockToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register a simple read-only test tool (tier: none)
  registry.register({
    name: "test_read",
    description: "A test read-only tool",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    security: { level: "read" },
    execute: async () => ({ success: true, data: { result: "read" } }),
  });

  // Register a write tool (tier: tier3)
  registry.register({
    name: "edit_file",
    description: "A test write tool",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    security: { level: "write" },
    execute: async () => ({ success: true, data: { result: "written" } }),
  });

  // Register a sign tool (tier: tier2)
  registry.register({
    name: "wallet_transfer",
    description: "A test wallet transfer tool",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number" },
        to: { type: "string" },
      },
      required: ["amount", "to"],
    },
    security: { level: "sign" },
    execute: async () => ({ success: true, data: { result: "transferred" } }),
  });

  // MCP-originated tools (name contains __)
  registry.register({
    name: "myserver__read_data",
    description: "MCP read tool",
    parameters: { type: "object", properties: {}, required: [] },
    security: { level: "read" },
    execute: async () => ({ success: true, data: { result: "mcp-read" } }),
  });

  registry.register({
    name: "myserver__write_data",
    description: "MCP write tool",
    parameters: { type: "object", properties: {}, required: [] },
    security: { level: "write" },
    execute: async () => ({ success: true, data: { result: "mcp-write" } }),
  });

  // MCP tool with missing security metadata (for fail-closed test)
  registry.register({
    name: "myserver__no_security",
    description: "MCP tool without security level",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => ({ success: true, data: { result: "should-not-reach" } }),
  } as any);

  return registry;
}

/**
 * Create a mock SessionStore (in-memory)
 */
export function createMockSessionStore(): SessionStore {
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

/**
 * Create a mock SessionTranscriptStore (in-memory)
 */
export function createMockTranscriptStore(): SessionTranscriptStore {
  const transcripts = new Map<string, any[]>();

  return {
    async append(sessionId, message) {
      const existing = transcripts.get(sessionId) ?? [];
      existing.push(message);
      transcripts.set(sessionId, existing);
    },

    async readAll(sessionId) {
      return transcripts.get(sessionId) ?? [];
    },

    async getHistory(sessionId) {
      return transcripts.get(sessionId) ?? [];
    },

    async clear(sessionId) {
      transcripts.delete(sessionId);
    },
  };
}

/**
 * Create all mock shared resources for testing
 */
export function createMockResources() {
  return {
    toolRegistry: createMockToolRegistry(),
    sessionStore: createMockSessionStore(),
    transcripts: createMockTranscriptStore(),
    workspacePath: "/tmp/test-workspace",
  };
}
