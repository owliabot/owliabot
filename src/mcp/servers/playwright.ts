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
  const chromiumPath = process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
  const noSandboxRaw = process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
  const useNoSandbox =
    typeof noSandboxRaw === "string" &&
    noSandboxRaw.length > 0 &&
    noSandboxRaw !== "0" &&
    noSandboxRaw.toLowerCase() !== "false";
  const useSystemChromium = !browser && typeof chromiumPath === "string" && chromiumPath.length > 0;
  const resolvedBrowser = useSystemChromium ? "chrome" : browser;
  const resolvedEnv = { ...env };

  if (useSystemChromium) {
    if (!resolvedEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      resolvedEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromiumPath;
    }
    if (!resolvedEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
      resolvedEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    }
  }
  if (useNoSandbox && !resolvedEnv.PLAYWRIGHT_MCP_NO_SANDBOX) {
    resolvedEnv.PLAYWRIGHT_MCP_NO_SANDBOX = "1";
  }

  // Build CLI args
  const args = ["--yes", "@playwright/mcp@latest"];

  if (headless) {
    args.push("--headless");
  }

  if (resolvedBrowser) {
    args.push("--browser", resolvedBrowser);
    if (useSystemChromium && chromiumPath) {
      args.push("--executable-path", chromiumPath);
    }
  }
  if (useNoSandbox && !args.includes("--no-sandbox")) {
    args.push("--no-sandbox");
  }

  return {
    ...playwrightServerConfig,
    args,
    env: resolvedEnv,
  };
}

// ============================================================================
// Security Overrides
// ============================================================================

/**
 * Recommended security overrides for Playwright tools
 * 
 * Most browser automation tools can modify state (click, type, navigate)
 * so they should be at least "write" level.
 *
 * Note: we treat pure navigation as "read" in OwliaBot because it doesn't
 * persistently mutate user data on third-party services, and it makes
 * browser-assisted research workflows usable without tripping the WriteGate.
 */
export const playwrightSecurityOverrides: Record<string, MCPSecurityOverride> = {
  // Navigation tools - read level (changes page state but doesn't modify external services)
  "playwright__browser_navigate": { level: "read" },
  "playwright__browser_go_back": { level: "read" },
  "playwright__browser_go_forward": { level: "read" },
  "playwright__browser_refresh": { level: "read" },
  
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

  // Browser installation - write level (installs browser binaries)
  "playwright__browser_install": { level: "write" },
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
  browser?: "chrome" | "firefox" | "webkit" | "msedge";
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

/**
 * Apply runtime defaults for explicit Playwright server configs.
 * Useful when config was authored without presets (e.g. onboard output).
 */
export function applyPlaywrightDefaults(
  config: MCPServerConfig
): MCPServerConfig {
  if (config.name !== "playwright") return config;

  const chromiumPath = process.env.OWLIABOT_PLAYWRIGHT_CHROMIUM_PATH;
  const noSandboxRaw = process.env.PLAYWRIGHT_MCP_NO_SANDBOX;
  const useNoSandbox =
    typeof noSandboxRaw === "string" &&
    noSandboxRaw.length > 0 &&
    noSandboxRaw !== "0" &&
    noSandboxRaw.toLowerCase() !== "false";
  const hasChromiumPath = typeof chromiumPath === "string" && chromiumPath.length > 0;

  const args = config.args ?? [];
  const browserIndex = args.indexOf("--browser");
  const hasBrowserArg = browserIndex >= 0;
  const browserValue = hasBrowserArg ? args[browserIndex + 1] : undefined;
  const hasExecutablePathArg = args.includes("--executable-path");
  const shouldForceChrome = hasChromiumPath && !hasBrowserArg;
  const shouldUseExecutablePath =
    hasChromiumPath &&
    !hasExecutablePathArg &&
    (browserValue === undefined || browserValue === "chrome");
  const nextArgs = [...args];

  if (shouldForceChrome) {
    nextArgs.push("--browser", "chrome");
  }
  if (shouldUseExecutablePath) {
    nextArgs.push("--executable-path", chromiumPath);
  }
  if (useNoSandbox && !nextArgs.includes("--no-sandbox")) {
    nextArgs.push("--no-sandbox");
  }

  const nextEnv = { ...(config.env ?? {}) };
  if (hasChromiumPath && !nextEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    nextEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromiumPath;
  }
  if (hasChromiumPath && !nextEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
    nextEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  }
  if (useNoSandbox && !nextEnv.PLAYWRIGHT_MCP_NO_SANDBOX) {
    nextEnv.PLAYWRIGHT_MCP_NO_SANDBOX = "1";
  }

  return {
    ...config,
    args: nextArgs,
    env: nextEnv,
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
