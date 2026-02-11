// src/gateway/tools-init.ts
/**
 * Tool initialization module.
 * Handles registration of builtin, exec, and web tools.
 */

import { createLogger } from "../utils/logger.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import {
  createBuiltinTools,
  createHelpTool,
  createExecTool,
  createWebFetchTool,
  createWebSearchTool,
} from "../agent/tools/builtin/index.js";
import type { createSessionStore } from "../agent/session-store.js";
import type { createSessionTranscriptStore } from "../agent/session-transcript.js";
import type { Config } from "../config/schema.js";

const log = createLogger("gateway:tools");

/**
 * Configuration for tool initialization.
 */
export interface ToolsInitConfig {
  /** Workspace root path */
  workspace: string;
  /** Session store instance */
  sessionStore: ReturnType<typeof createSessionStore>;
  /** Transcript store instance */
  transcripts: ReturnType<typeof createSessionTranscriptStore>;
  /** Tool-specific configuration from config.tools */
  toolsConfig?: Config["tools"];
  /** Wallet configuration */
  walletConfig?: Config["wallet"];
  /** System action configuration (exec, web, webSearch) */
  systemConfig?: Config["system"];
}

/**
 * Initializes all tools and returns a populated ToolRegistry.
 * 
 * Registers in order:
 * 1. Builtin tools (read, write, edit, etc.)
 * 2. Exec tool (if config.system.exec is present)
 * 3. Web fetch tool (if config.system.web is present)
 * 4. Web search tool (if config.system.webSearch is present)
 * 5. Help tool (last, needs registry reference)
 * 
 * @param config - Tool initialization configuration
 * @returns Populated ToolRegistry instance
 * 
 * @example
 * ```ts
 * const tools = initializeTools({
 *   workspace: config.workspace,
 *   sessionStore,
 *   transcripts,
 *   systemConfig: config.system,
 * });
 * ```
 */
export async function initializeTools(config: ToolsInitConfig): Promise<ToolRegistry> {
  const tools = new ToolRegistry();

  // Register builtin tools via factory
  const builtinTools = await createBuiltinTools({
    workspace: config.workspace,
    sessionStore: config.sessionStore,
    transcripts: config.transcripts,
    tools: config.toolsConfig,
    wallet: config.walletConfig,
  });
  
  for (const tool of builtinTools) {
    tools.register(tool);
  }
  log.debug(`Registered ${builtinTools.length} builtin tools`);

  // Register system action tools conditionally
  const systemConfig = config.systemConfig;
  
  if (systemConfig?.exec) {
    tools.register(
      createExecTool({
        workspacePath: config.workspace,
        config: systemConfig.exec,
      })
    );
    log.debug("Registered exec tool");
  }

  if (systemConfig?.web) {
    tools.register(
      createWebFetchTool({
        config: systemConfig.web,
      })
    );
    log.debug("Registered web_fetch tool");
  }

  // web_search requires explicit webSearch config
  // (web config alone is not sufficient for search API)
  if (systemConfig?.webSearch) {
    tools.register(
      createWebSearchTool({
        config: {
          web: systemConfig?.web,
          webSearch: systemConfig.webSearch,
        },
      })
    );
    log.debug("Registered web_search tool");
  }

  // Help tool goes last - needs registry reference for tool listing
  tools.register(createHelpTool(tools));
  log.debug("Registered help tool");

  log.info(`Tool registry initialized with ${tools.getAll().length} tools`);
  return tools;
}

/**
 * Registers additional tools to an existing registry.
 * Useful for adding skill-provided tools after initial setup.
 * 
 * @param registry - Existing tool registry
 * @param tools - Array of tool definitions to add
 */
export function registerAdditionalTools(
  registry: ToolRegistry,
  tools: Array<{ name: string; description: string; parameters: object; execute: Function; security: { level: string } }>,
): void {
  for (const tool of tools) {
    registry.register(tool as any);
    log.debug(`Registered additional tool: ${tool.name}`);
  }
}
