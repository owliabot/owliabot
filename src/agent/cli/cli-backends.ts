/**
 * Default CLI Backend Configurations
 * Pre-configured backends for claude-cli and codex-cli
 */

import type { CliBackend } from "./cli-schema.js";

/**
 * Default configuration for Claude CLI (claude)
 * Uses --dangerously-skip-permissions for autonomous operation.
 */
export const DEFAULT_CLAUDE_BACKEND: CliBackend = {
  command: "claude",
  args: ["-p", "--output-format", "json", "--dangerously-skip-permissions"],
  resumeArgs: [
    "-p",
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
    "--resume",
    "{sessionId}",
  ],
  output: "json",
  input: "arg",
  modelArg: "--model",
  modelAliases: {
    // Opus aliases
    opus: "opus",
    "opus-4.5": "opus",
    "claude-opus-4-5": "opus",
    // Sonnet aliases
    sonnet: "sonnet",
    "sonnet-4.5": "sonnet",
    "claude-sonnet-4-5": "sonnet",
    // Haiku aliases
    haiku: "haiku",
    "haiku-3.5": "haiku",
    "claude-haiku-4-5": "haiku",
  },
  sessionArg: "--session-id",
  sessionMode: "always",
  sessionIdFields: ["session_id", "sessionId", "conversation_id"],
  systemPromptArg: "--append-system-prompt",
  systemPromptMode: "append",
  systemPromptWhen: "first",
  clearEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_OLD"],
  serialize: true,
};

/**
 * Default configuration for OpenAI Codex CLI (codex)
 * Similar structure to claude-cli but for OpenAI's codex tool.
 */
export const DEFAULT_CODEX_BACKEND: CliBackend = {
  command: "codex",
  args: ["--quiet", "--full-auto", "--json"],
  resumeArgs: ["--quiet", "--full-auto", "--json", "--resume", "{sessionId}"],
  output: "jsonl",
  input: "arg",
  modelArg: "--model",
  modelAliases: {
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
    "o1": "o1",
    "o1-mini": "o1-mini",
    "o3": "o3",
    "o3-mini": "o3-mini",
  },
  sessionArg: "--session-id",
  sessionMode: "always",
  sessionIdFields: ["session_id", "sessionId"],
  systemPromptArg: "--instructions",
  systemPromptMode: "append",
  systemPromptWhen: "first",
  clearEnv: ["OPENAI_API_KEY"],
  serialize: true,
};

/**
 * Map of built-in CLI backend IDs to their default configurations.
 */
export const BUILTIN_CLI_BACKENDS: Record<string, CliBackend> = {
  "claude-cli": DEFAULT_CLAUDE_BACKEND,
  "codex-cli": DEFAULT_CODEX_BACKEND,
};

/**
 * Get the default backend config for a known CLI provider.
 * Returns undefined if not a built-in provider.
 */
export function getBuiltinBackend(providerId: string): CliBackend | undefined {
  const normalized = normalizeProviderId(providerId);
  return BUILTIN_CLI_BACKENDS[normalized];
}

/**
 * Normalize a provider ID for comparison.
 * Lowercases and handles common variations.
 */
export function normalizeProviderId(providerId: string): string {
  return providerId.toLowerCase().replace(/_/g, "-");
}
