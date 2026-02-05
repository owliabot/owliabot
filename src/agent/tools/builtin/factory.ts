/**
 * Builtin tools factory
 *
 * Creates all builtin tools with a unified options interface.
 * Matches OpenClaw's factory pattern for consistency.
 *
 * Special cases (registered separately):
 * - helpTool: Needs ToolRegistry reference, registered last
 * - cronTool: Needs CronService which is created after initial setup
 */

import type { ToolDefinition } from "../interface.js";
import type { SessionStore } from "../../session-store.js";
import type { SessionTranscriptStore } from "../../session-transcript.js";

import { echoTool } from "./echo.js";
import { createClearSessionTool } from "./clear-session.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createMemoryGetTool } from "./memory-get.js";
import { createListFilesTool } from "./list-files.js";
import { createEditFileTool } from "./edit-file.js";

/**
 * Options for creating builtin tools
 */
export interface BuiltinToolsOptions {
  /** Workspace directory path */
  workspace: string;

  /** Session store for clear_session tool */
  sessionStore: SessionStore;

  /** Transcript store for clear_session tool */
  transcripts: SessionTranscriptStore;

  /** Tool configuration */
  tools?: {
    /** Enable write tools (edit_file). Default: false */
    allowWrite?: boolean;
  };
}

/**
 * Create all builtin tools (except help and cron).
 *
 * Usage:
 * ```ts
 * const tools = new ToolRegistry();
 * for (const tool of createBuiltinTools(opts)) {
 *   tools.register(tool);
 * }
 * tools.register(createHelpTool(tools));  // Last - needs registry
 * // ... after cron setup ...
 * tools.register(createCronTool({ cronService }));
 * ```
 *
 * @param opts - Options containing workspace path, stores, and config
 * @returns Array of tool definitions
 */
export function createBuiltinTools(
  opts: BuiltinToolsOptions,
): ToolDefinition[] {
  const { workspace, sessionStore, transcripts, tools: toolsConfig } = opts;

  const builtins: (ToolDefinition | null)[] = [
    // Core tools (always available)
    echoTool,
    createClearSessionTool({ sessionStore, transcripts }),
    createMemorySearchTool(workspace),
    createMemoryGetTool(workspace),
    createListFilesTool(workspace),

    // Write tools (gated by config)
    toolsConfig?.allowWrite ? createEditFileTool(workspace) : null,
  ];

  return builtins.filter((t): t is ToolDefinition => t !== null);
}
