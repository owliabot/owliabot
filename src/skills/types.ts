/**
 * Skill System Type Definitions
 * @see docs/design/skill-system.md
 */

import { z } from "zod";
import type { JsonSchema, ToolResult } from "../agent/tools/interface.js";

// Tool definition in package.json owliabot field
export const skillToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional(),
  }),
  security: z.object({
    level: z.enum(["read", "write", "sign"]),
  }),
  timeout: z.number().optional(), // ms, default 30000
});

// owliabot field in package.json
export const owliabotConfigSchema = z.object({
  requires: z
    .object({
      env: z.array(z.string()).optional(),
    })
    .optional(),
  tools: z.array(skillToolSchema),
});

// Full package.json schema for skills
export const skillManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  main: z.string().default("index.js"),
  owliabot: owliabotConfigSchema,
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillToolDef = z.infer<typeof skillToolSchema>;
export type OwliabotConfig = z.infer<typeof owliabotConfigSchema>;

// ── Signer Result ─────────────────────────────────────────────────────────

/**
 * Result from a signer operation (blockchain transaction)
 */
export interface SignerResult {
  success: boolean;
  data?: {
    txHash?: string;
    [key: string]: unknown;
  };
  error?: string;
}

// ── Skill Context ─────────────────────────────────────────────────────────

/**
 * Context passed to skill tool execution.
 * Provides sandboxed access to tools, signing, and user interaction.
 * @see docs/design/skill-system.md Section 4
 */
export interface SkillContext {
  // Environment variables (only those declared in requires.env)
  env: Record<string, string>;

  // Network requests (MVP: native fetch)
  fetch: typeof globalThis.fetch;

  // Call metadata
  meta: {
    skillName: string;
    toolName: string;
    callId: string;
    userId: string;
    channel: string;
  };

  // ── NEW: Tool/Signer calls ────────────────────────────────────────────

  /**
   * Call a tool through the security pipeline.
   * Write-level tools automatically go through WriteGate.
   * @param name Tool name (e.g., "read-file", "edit-file")
   * @param args Tool arguments
   */
  callTool: (name: string, args: unknown) => Promise<ToolResult>;

  /**
   * Call a signer operation for blockchain transactions.
   * Automatically goes through TierPolicy for approval.
   * @param operation Operation name (e.g., "transfer", "approve")
   * @param params Operation parameters
   */
  callSigner: (operation: string, params: unknown) => Promise<SignerResult>;

  // ── NEW: User interaction ─────────────────────────────────────────────

  /**
   * Send a message to the user in the current session.
   * @param text Message text to send
   */
  sendMessage: (text: string) => Promise<void>;

  /**
   * Ask the user for confirmation.
   * @param prompt The question to ask
   * @returns true if confirmed, false otherwise
   */
  askConfirmation: (prompt: string) => Promise<boolean>;

  // ── NEW: File I/O (sandboxed to workspace) ─────────────────────────────

  /**
   * Read a file from the skill's workspace.
   * Path is resolved relative to workspace.
   * @param path File path (relative to workspace)
   */
  readFile: (path: string) => Promise<string>;

  /**
   * Write a file to the skill's workspace.
   * Path is resolved relative to workspace.
   * @param path File path (relative to workspace)
   * @param content File content to write
   */
  writeFile: (path: string, content: string) => Promise<void>;

  // ── NEW: Workspace ────────────────────────────────────────────────────

  /**
   * Absolute path to the skill workspace directory.
   * Skills should use this for file operations.
   */
  workspace: string;
}

// ── Skill Module ──────────────────────────────────────────────────────────

/**
 * Skill module export format
 */
export interface SkillModule {
  tools: Record<
    string,
    (params: unknown, context: SkillContext) => Promise<ToolResult | unknown>
  >;
}

/**
 * Loaded skill with manifest and module
 */
export interface LoadedSkill {
  manifest: SkillManifest;
  module: SkillModule;
  path: string;
}

// ── Re-export ToolResult for convenience ──────────────────────────────────

export type { ToolResult } from "../agent/tools/interface.js";
