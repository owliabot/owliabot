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

import { readFileSync, existsSync } from "node:fs";
import type { ToolDefinition } from "../interface.js";
import type { SessionStore } from "../../session-store.js";
import type { SessionTranscriptStore } from "../../session-transcript.js";
import { filterToolsByPolicy, type ToolPolicy } from "../policy.js";
import { createLogger } from "../../../utils/logger.js";

import { echoTool } from "./echo.js";
import { createClearSessionTool } from "./clear-session.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createMemoryGetTool } from "./memory-get.js";
import { createListFilesTool } from "./list-files.js";
import { createEditFileTool } from "./edit-file.js";
import { createWalletBalanceTool } from "./wallet-balance.js";
import { createWalletTransferTool } from "./wallet-transfer.js";
import type { ClawletClientConfig } from "../../../wallet/index.js";

const log = createLogger("builtin-tools");

/**
 * Wallet configuration subset needed by factory
 */
export interface WalletFactoryConfig {
  enabled?: boolean;
  provider?: "clawlet";
  clawlet?: {
    socketPath?: string;
    authTokenFile?: string;
    authToken?: string;
    connectTimeout?: number;
    requestTimeout?: number;
  };
  defaultChainId?: number;
}

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
    /** Policy for filtering tools */
    policy?: ToolPolicy;
  };

  /** Wallet configuration (Clawlet integration) */
  wallet?: WalletFactoryConfig;
}

/**
 * Resolve auth token from file or direct config
 * Reads authTokenFile if specified, otherwise uses authToken
 */
function resolveAuthToken(clawletConfig?: WalletFactoryConfig["clawlet"]): string | undefined {
  if (!clawletConfig) return undefined;

  // Prefer authTokenFile over authToken for security
  if (clawletConfig.authTokenFile) {
    const tokenPath = clawletConfig.authTokenFile.replace(/^~/, process.env.HOME ?? ".");
    if (existsSync(tokenPath)) {
      try {
        const token = readFileSync(tokenPath, "utf-8").trim();
        if (token) {
          log.debug(`Loaded auth token from ${tokenPath}`);
          return token;
        }
      } catch (err) {
        log.warn(`Failed to read auth token file ${tokenPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      log.warn(`Auth token file not found: ${tokenPath}`);
    }
  }

  // Fallback to direct authToken
  return clawletConfig.authToken;
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
  const { workspace, sessionStore, transcripts, tools: toolsConfig, wallet: walletConfig } = opts;

  const builtins: (ToolDefinition | null)[] = [
    // Core tools (always available)
    echoTool,
    createClearSessionTool({ sessionStore, transcripts }),
    createMemorySearchTool({ workspace }),
    createMemoryGetTool({ workspace }),
    createListFilesTool({ workspace }),

    // Write tools (gated by config)
    toolsConfig?.allowWrite ? createEditFileTool({ workspace }) : null,
  ];

  // Wallet tools (gated by wallet.enabled)
  if (walletConfig?.enabled && walletConfig.provider === "clawlet") {
    const authToken = resolveAuthToken(walletConfig.clawlet);
    const clawletClientConfig: ClawletClientConfig = {
      socketPath: walletConfig.clawlet?.socketPath,
      authToken,
      connectTimeout: walletConfig.clawlet?.connectTimeout,
      requestTimeout: walletConfig.clawlet?.requestTimeout,
    };
    const defaultChainId = walletConfig.defaultChainId ?? 8453;

    log.info(`Wallet tools enabled (chain: ${defaultChainId}, socket: ${clawletClientConfig.socketPath ?? "default"})`);

    builtins.push(
      createWalletBalanceTool({
        clawletConfig: clawletClientConfig,
        defaultChainId,
      }),
      createWalletTransferTool({
        clawletConfig: clawletClientConfig,
        defaultChainId,
      }),
    );
  }

  // Filter out null entries
  const tools = builtins.filter((t): t is ToolDefinition => t !== null);

  // Apply policy filtering
  return filterToolsByPolicy(tools, toolsConfig?.policy);
}
