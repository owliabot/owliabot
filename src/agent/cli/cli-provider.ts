/**
 * CLI Provider Detection and Configuration Resolution
 * Determines if a provider uses CLI backend and resolves its configuration.
 */

import type { CliBackend, CliBackends } from "./cli-schema.js";
import {
  normalizeProviderId,
  getBuiltinBackend,
  DEFAULT_CLAUDE_BACKEND,
  DEFAULT_CODEX_BACKEND,
} from "./cli-backends.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("cli-provider");

/**
 * Configuration interface expected by CLI provider functions.
 * This should match your existing Config type structure.
 */
export interface ConfigWithCliBackends {
  agents?: {
    defaults?: {
      cliBackends?: CliBackends;
    };
  };
}

/**
 * Check if a provider ID corresponds to a CLI-based provider.
 *
 * @param provider - Provider ID to check (e.g., "claude-cli", "codex-cli")
 * @param cfg - Configuration object that may contain custom cliBackends
 * @returns true if the provider should use CLI execution
 */
export function isCliProvider(provider: string, cfg?: ConfigWithCliBackends): boolean {
  const normalized = normalizeProviderId(provider);

  // Built-in CLI providers
  if (normalized === "claude-cli") return true;
  if (normalized === "codex-cli") return true;

  // Check custom cliBackends in config
  const backends = cfg?.agents?.defaults?.cliBackends ?? {};
  return Object.keys(backends).some((key) => normalizeProviderId(key) === normalized);
}

/**
 * Resolve the complete CLI backend configuration for a provider.
 * Merges user config over built-in defaults.
 *
 * @param provider - Provider ID
 * @param cfg - Configuration object with optional cliBackends overrides
 * @returns Merged CLI backend configuration
 * @throws Error if provider is not a CLI provider
 */
export function resolveCliBackendConfig(
  provider: string,
  cfg?: ConfigWithCliBackends
): CliBackend {
  const normalized = normalizeProviderId(provider);

  // Get user config if present
  const backends = cfg?.agents?.defaults?.cliBackends ?? {};
  const userConfig = Object.entries(backends).find(
    ([key]) => normalizeProviderId(key) === normalized
  )?.[1];

  // Get built-in default
  const builtinConfig = getBuiltinBackend(normalized);

  if (!builtinConfig && !userConfig) {
    throw new Error(
      `Unknown CLI provider: ${provider}. ` +
        `Configure it in agents.defaults.cliBackends or use a built-in provider (claude-cli, codex-cli).`
    );
  }

  // Merge: user config overrides built-in defaults
  // At least one of builtinConfig or userConfig must exist (checked above)
  // Start with builtin (or empty), then override with user config
  const baseConfig = builtinConfig ?? { command: "" };
  const merged: CliBackend = {
    ...baseConfig,
    ...userConfig,
  };

  // Ensure command is set (required field)
  if (!merged.command) {
    throw new Error(
      `CLI provider ${provider} missing required 'command' field. ` +
        `Ensure your cliBackends config includes a command.`
    );
  }

  log.debug(`Resolved CLI backend for ${provider}:`, merged);
  return merged;
}

/**
 * Resolve model name through backend aliases.
 *
 * @param model - Input model name
 * @param backend - CLI backend configuration
 * @returns Resolved model name (alias applied if found)
 */
export function resolveCliModel(model: string, backend: CliBackend): string {
  const aliases = backend.modelAliases ?? {};
  const resolved = aliases[model] ?? model;

  if (resolved !== model) {
    log.debug(`Resolved model alias: ${model} → ${resolved}`);
  }

  return resolved;
}

/**
 * Check if a model string looks like it's targeting a CLI provider.
 * Useful for auto-detection from model strings like "claude-cli/opus".
 *
 * @param modelString - Model string to check
 * @returns true if the model string indicates CLI provider usage
 */
export function isCliModelString(modelString: string): boolean {
  if (!modelString.includes("/")) return false;
  const [provider] = modelString.split("/", 2);
  return isCliProvider(provider);
}

/**
 * Parse a CLI model string into provider and model components.
 *
 * @param modelString - Model string (e.g., "claude-cli/opus")
 * @returns Object with provider and model, or null if not a CLI model string
 */
export function parseCliModelString(
  modelString: string
): { provider: string; model: string } | null {
  if (!modelString.includes("/")) return null;
  const [provider, model] = modelString.split("/", 2);
  if (!isCliProvider(provider)) return null;
  return { provider, model };
}
