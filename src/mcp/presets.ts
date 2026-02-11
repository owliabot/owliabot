/**
 * MCP Preset Expansion
 * Converts preset names (e.g. "playwright") into full server configs.
 */

import { createLogger } from "../utils/logger.js";
import { createPlaywrightConfig, playwrightSecurityOverrides } from "./servers/playwright.js";
import type { MCPServerConfig, MCPSecurityOverride } from "./types.js";

const log = createLogger("mcp:presets");

/** Registry of known preset names → server config + security overrides factories */
const PRESET_REGISTRY: Record<string, {
  config: () => MCPServerConfig;
  securityOverrides: Record<string, MCPSecurityOverride>;
}> = {
  playwright: {
    config: () => createPlaywrightConfig({ headless: true }),
    securityOverrides: playwrightSecurityOverrides,
  },
};

export interface ExpandedPresets {
  servers: MCPServerConfig[];
  securityOverrides: Record<string, MCPSecurityOverride>;
}

/**
 * Expand an array of preset names into MCPServerConfig objects + their security overrides.
 * Unknown presets are logged as warnings and skipped.
 */
export function expandMCPPresets(presets: string[]): ExpandedPresets {
  const seen = new Set<string>();
  const servers: MCPServerConfig[] = [];
  const securityOverrides: Record<string, MCPSecurityOverride> = {};

  for (const name of presets) {
    const preset = PRESET_REGISTRY[name];
    if (preset) {
      if (seen.has(name)) {
        log.debug(`Skipping duplicate MCP preset: "${name}"`);
        continue;
      }
      seen.add(name);
      servers.push(preset.config());
      Object.assign(securityOverrides, preset.securityOverrides);
      log.info(`Expanded MCP preset: ${name}`);
    } else {
      log.warn(`Unknown MCP preset: "${name}" — skipping`);
    }
  }

  return { servers, securityOverrides };
}

/**
 * Get default security overrides for a server by name.
 * Returns preset overrides if the server name matches a known preset, empty object otherwise.
 * This ensures preset security defaults apply even when servers are configured manually.
 */
export function getDefaultSecurityOverrides(serverName: string): Record<string, MCPSecurityOverride> {
  const preset = PRESET_REGISTRY[serverName];
  return preset ? { ...preset.securityOverrides } : {};
}

/** Get list of available preset names */
export function getAvailablePresets(): string[] {
  return Object.keys(PRESET_REGISTRY);
}
