/**
 * CLI Backend Schema (Zod)
 * Defines configuration structure for CLI-based LLM backends (claude-cli, codex-cli, etc.)
 * @see OpenClaw implementation for reference
 */

import { z } from "zod";

/**
 * Schema for a single CLI backend configuration.
 * Supports claude-cli, codex-cli, and custom CLI-based LLM tools.
 */
export const CliBackendSchema = z.object({
  /** Command to execute (e.g., "claude", "codex") */
  command: z.string(),

  /** Base arguments for new sessions */
  args: z.array(z.string()).optional(),

  /** Output format: json, text, or jsonl (streaming) */
  output: z.enum(["json", "text", "jsonl"]).optional(),

  /** Output format when resuming a session (may differ from initial) */
  resumeOutput: z.enum(["json", "text", "jsonl"]).optional(),

  /** How to pass the prompt: as CLI arg or via stdin */
  input: z.enum(["arg", "stdin"]).optional(),

  /** Max characters for prompt when using arg input (longer → stdin) */
  maxPromptArgChars: z.number().int().positive().optional(),

  /** Environment variables to set for the CLI process */
  env: z.record(z.string(), z.string()).optional(),

  /** Environment variables to clear (prevent leaking API keys) */
  clearEnv: z.array(z.string()).optional(),

  /** CLI argument for model selection (e.g., "--model") */
  modelArg: z.string().optional(),

  /** Model name aliases (e.g., "opus" → "opus") */
  modelAliases: z.record(z.string(), z.string()).optional(),

  /** CLI argument for session ID (e.g., "--session-id") */
  sessionArg: z.string().optional(),

  /** Additional args when starting a new session */
  sessionArgs: z.array(z.string()).optional(),

  /** Args template for resuming a session (use {sessionId} placeholder) */
  resumeArgs: z.array(z.string()).optional(),

  /** Session mode: always create/resume, existing only, or none */
  sessionMode: z.enum(["always", "existing", "none"]).optional(),

  /** Fields in output JSON that contain session ID */
  sessionIdFields: z.array(z.string()).optional(),

  /** CLI argument for system prompt injection */
  systemPromptArg: z.string().optional(),

  /** Whether system prompt appends or replaces */
  systemPromptMode: z.enum(["append", "replace"]).optional(),

  /** When to inject system prompt: always or first message only */
  systemPromptWhen: z.enum(["always", "first"]).optional(),

  /** CLI argument for passing images */
  imageArg: z.string().optional(),

  /** If true, serialize CLI calls (queue concurrent requests) */
  serialize: z.boolean().optional(),
});

export type CliBackend = z.infer<typeof CliBackendSchema>;

/**
 * Schema for the cliBackends config section.
 * Maps provider IDs to their CLI backend configurations.
 */
export const CliBackendsSchema = z.record(z.string(), CliBackendSchema).optional();

export type CliBackends = z.infer<typeof CliBackendsSchema>;

/**
 * Extended agents schema with CLI backends support.
 * This extends the existing agentsSchema to include cliBackends.
 */
export const AgentsWithCliBackendsSchema = z.object({
  defaultId: z.string().default("main"),
  defaults: z
    .object({
      /** CLI backends configuration */
      cliBackends: CliBackendsSchema,
    })
    .optional(),
});

export type AgentsWithCliBackends = z.infer<typeof AgentsWithCliBackendsSchema>;
