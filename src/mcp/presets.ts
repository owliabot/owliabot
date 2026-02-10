/**
 * MCP Preset Expansion
 * Converts preset names (e.g. "playwright") into full server configs.
 */

import { createLogger } from "../utils/logger.js";
import { createPlaywrightConfig, playwrightSecurityOverrides } from "./servers/playwright.js";
import type { MCPServerConfig, MCPSecurityOverride } from "./types.js";

const log = createLogger("mcp:presets");

/** Registry of known preset names → server config factories */
const PRESET_REGISTRY: Record<string, () => MCPServerConfig> = {
  playwright: () => createPlaywrightConfig({ headless: true }),
};

/** Registry of known preset/server names → security overrides */
const PRESET_SECURITY_OVERRIDES: Record<string, Record<string, MCPSecurityOverride>> = {
  playwright: playwrightSecurityOverrides,
};

/**
 * Expand an array of preset names into MCPServerConfig objects.
 * Unknown presets are logged as warnings and skipped.
 */
export function expandMCPPresets(presets: string[]): MCPServerConfig[] {
  const seen = new Set<string>();
  const configs: MCPServerConfig[] = [];

  for (const name of presets) {
    const factory = PRESET_REGISTRY[name];
    if (factory) {
      if (seen.has(name)) {
        log.debug(`Skipping duplicate MCP preset: "${name}"`);
        continue;
      }
      seen.add(name);
      configs.push(factory());
      log.info(`Expanded MCP preset: ${name}`);
    } else {
      log.warn(`Unknown MCP preset: "${name}" — skipping`);
    }
  }

  return configs;
}

/**
 * Expand an array of preset names into a merged security overrides map.
 * Later user-provided config should override these defaults.
 */
export function expandMCPPresetSecurityOverrides(
  presets: string[],
): Record<string, MCPSecurityOverride> {
  const seen = new Set<string>();
  const merged: Record<string, MCPSecurityOverride> = {};

  for (const name of presets) {
    if (seen.has(name)) continue;
    seen.add(name);

    const overrides = PRESET_SECURITY_OVERRIDES[name];
    if (overrides) {
      Object.assign(merged, overrides);
    }
  }

  return merged;
}

/**
 * Get built-in security overrides for a well-known MCP server name.
 * Useful when users configured servers explicitly instead of using presets.
 */
export function getKnownServerSecurityOverrides(
  serverName: string,
): Record<string, MCPSecurityOverride> | undefined {
  return PRESET_SECURITY_OVERRIDES[serverName];
}

/** Get list of available preset names */
export function getAvailablePresets(): string[] {
  return Object.keys(PRESET_REGISTRY);
}
