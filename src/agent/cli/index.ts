/**
 * CLI Provider Module
 * Re-exports all CLI-related functionality for clean imports.
 *
 * Usage:
 *   import { isCliProvider, runCliAgent } from "./cli/index.js";
 */

// Schema exports
export {
  CliBackendSchema,
  CliBackendsSchema,
  AgentsWithCliBackendsSchema,
  type CliBackend,
  type CliBackends,
  type AgentsWithCliBackends,
} from "./cli-schema.js";

// Backend configuration exports
export {
  DEFAULT_CLAUDE_BACKEND,
  DEFAULT_CODEX_BACKEND,
  BUILTIN_CLI_BACKENDS,
  getBuiltinBackend,
  normalizeProviderId,
} from "./cli-backends.js";

// Provider detection exports
export {
  isCliProvider,
  resolveCliBackendConfig,
  resolveCliModel,
  isCliModelString,
  parseCliModelString,
  type ConfigWithCliBackends,
} from "./cli-provider.js";

// Runner exports
export {
  runCliAgent,
  isCliCommandAvailable,
  type CliAgentResult,
  type CliAgentOptions,
} from "./cli-runner.js";
