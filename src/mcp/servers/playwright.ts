/**
 * Playwright MCP Server Configuration
 * Pre-configured setup for @anthropic/mcp-server-playwright
 * 
 * @see https://github.com/anthropics/mcp-server-playwright
 */

import type { MCPServerConfig, MCPSecurityOverride } from "../types.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default configuration for Playwright MCP server
 */
export const playwrightServerConfig: MCPServerConfig = {
  name: "playwright",
  command: "npx",
  args: ["--yes", "@playwright/mcp@latest"],
  transport: "stdio",
  env: {
    // Note: @playwright/mcp uses --headless flag, not env var
  },
};

/**
 * Create Playwright server config with custom options
 */
export function createPlaywrightConfig(options?: {
  /** Run browser in headless mode (default: true) */
  headless?: boolean;
  /** Browser type: chrome, firefox, webkit, msedge (default: chrome) */
  browser?: "chrome" | "firefox" | "webkit" | "msedge";
  /** Additional environment variables */
  env?: Record<string, string>;
}): MCPServerConfig {
  const { headless = true, browser, env = {} } = options ?? {};

  // Build CLI args
  const args = ["--yes", "@playwright/mcp@latest"];

  if (headless) {
    args.push("--headless");
  }

  if (browser) {
    args.push("--browser", browser);
  }

  return {
    ...playwrightServerConfig,
    args,
    env,
  };
}

// ============================================================================
// Security Overrides
// ============================================================================

/**
 * Recommended security overrides for Playwright tools
 * 
 * Most browser automation tools can modify state (click, type, navigate)
 * so they should be at least "write" level
 */
export const playwrightSecurityOverrides: Record<string, MCPSecurityOverride> = {
  // Navigation tools - write level (changes page state)
  "playwright__browser_navigate": { level: "write" },
  "playwright__browser_go_back": { level: "write" },
  "playwright__browser_go_forward": { level: "write" },
  "playwright__browser_refresh": { level: "write" },
  
  // Interaction tools - write level (modifies page)
  "playwright__browser_click": { level: "write" },
  "playwright__browser_type": { level: "write" },
  "playwright__browser_fill": { level: "write" },
  "playwright__browser_select": { level: "write" },
  "playwright__browser_check": { level: "write" },
  "playwright__browser_uncheck": { level: "write" },
  "playwright__browser_press": { level: "write" },
  "playwright__browser_scroll": { level: "write" },
  "playwright__browser_hover": { level: "write" },
  "playwright__browser_drag": { level: "write" },
  
  // Tab/window management - write level
  "playwright__browser_new_tab": { level: "write" },
  "playwright__browser_close_tab": { level: "write" },
  "playwright__browser_switch_tab": { level: "write" },
  
  // Screenshot/PDF - read level (doesn't modify state)
  "playwright__browser_screenshot": { level: "read" },
  "playwright__browser_pdf": { level: "read" },
  
  // Page content inspection - read level
  "playwright__browser_get_content": { level: "read" },
  "playwright__browser_get_text": { level: "read" },
  "playwright__browser_get_attribute": { level: "read" },
  "playwright__browser_get_url": { level: "read" },
  "playwright__browser_get_title": { level: "read" },
  "playwright__browser_evaluate": { level: "write" }, // JS execution can modify state
  
  // File operations - write level with confirmation
  "playwright__browser_upload": { level: "write", confirmRequired: true },
  "playwright__browser_download": { level: "write" },
};

// ============================================================================
// Presets
// ============================================================================

/**
 * Complete preset with server config and security overrides
 */
export const playwrightPreset = {
  server: playwrightServerConfig,
  securityOverrides: playwrightSecurityOverrides,
};

/**
 * Get preset with custom options
 */
export function getPlaywrightPreset(options?: {
  headless?: boolean;
  browser?: "chromium" | "firefox" | "webkit";
  env?: Record<string, string>;
  /** Additional security overrides */
  additionalOverrides?: Record<string, MCPSecurityOverride>;
}) {
  return {
    server: createPlaywrightConfig(options),
    securityOverrides: {
      ...playwrightSecurityOverrides,
      ...(options?.additionalOverrides ?? {}),
    },
  };
}

// ============================================================================
// Usage Examples (in comments)
// ============================================================================

/**
 * @example Basic usage in config.yaml
 * ```yaml
 * mcp:
 *   servers:
 *     - name: playwright
 *       command: npx
 *       args: ["--yes", "@anthropic/mcp-server-playwright@latest"]
 *       transport: stdio
 *       env:
 *         PLAYWRIGHT_HEADLESS: "true"
 *   
 *   securityOverrides:
 *     playwright__browser_navigate:
 *       level: write
 *     playwright__browser_click:
 *       level: write
 * ```
 * 
 * @example Programmatic usage
 * ```typescript
 * import { createMCPTools } from "../index.js";
 * import { getPlaywrightPreset } from "./playwright.js";
 * 
 * const preset = getPlaywrightPreset({ headless: false });
 * 
 * const result = await createMCPTools({
 *   servers: [preset.server],
 *   securityOverrides: preset.securityOverrides,
 * });
 * ```
 */
