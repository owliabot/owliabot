/**
 * MCP Preset Expansion
 * Converts preset names (e.g. "playwright") into full server configs.
 */

import { createLogger } from "../utils/logger.js";
import { createPlaywrightConfig } from "./servers/playwright.js";
import type { MCPServerConfig } from "./types.js";

const log = createLogger("mcp:presets");

/** Registry of known preset names → server config factories */
const PRESET_REGISTRY: Record<string, () => MCPServerConfig> = {
  playwright: () => createPlaywrightConfig({ headless: true }),
};

/**
 * Expand an array of preset names into MCPServerConfig objects.
 * Unknown presets are logged as warnings and skipped.
 */
export function expandMCPPresets(presets: string[]): MCPServerConfig[] {
  const configs: MCPServerConfig[] = [];

  for (const name of presets) {
    const factory = PRESET_REGISTRY[name];
    if (factory) {
      configs.push(factory());
      log.info(`Expanded MCP preset: ${name}`);
    } else {
      log.warn(`Unknown MCP preset: "${name}" — skipping`);
    }
  }

  return configs;
}

/** Get list of available preset names */
export function getAvailablePresets(): string[] {
  return Object.keys(PRESET_REGISTRY);
}
