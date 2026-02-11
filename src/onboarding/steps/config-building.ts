/**
 * Step module: config building from prompts.
 */

import { createInterface } from "node:readline";
import { join } from "node:path";
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { getWorkspacePath } from "./workspace-setup.js";
import { getGatewayConfig } from "./gateway-setup.js";
import { configureDiscordConfig } from "./configure-discord.js";
import { configureTelegramConfig } from "./configure-telegram.js";
import { configureWriteToolsSecurity } from "./security-setup.js";
import type { UserAllowLists } from "./types.js";
import { info, header, askYN } from "../shared.js";
import { playwrightServerConfig, playwrightSecurityOverrides } from "../../mcp/servers/playwright.js";

export function buildDefaultMemorySearchConfig(workspace: string): MemorySearchConfig {
  return {
    enabled: true,
    provider: "sqlite",
    fallback: "naive",
    store: {
      path: join(workspace, "memory", "{agentId}.sqlite"),
    },
    extraPaths: [],
    sources: ["files"],
    indexing: {
      autoIndex: true,
      minIntervalMs: 5 * 60 * 1000,
    },
  };
}

export function buildDefaultSystemConfig(): SystemCapabilityConfig {
  return {
    exec: {
      commandAllowList: [
        "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
        "date", "env", "which", "file", "stat", "du", "df", "curl",
        "rm", "mkdir", "touch", "mv", "cp",
      ],
      envAllowList: ["PATH", "HOME", "USER", "LANG", "LC_ALL"],
      timeoutMs: 60_000,
      maxOutputBytes: 256 * 1024,
    },
    web: {
      domainAllowList: [],
      domainDenyList: [],
      allowPrivateNetworks: false,
      timeoutMs: 15_000,
      maxResponseBytes: 512 * 1024,
      blockOnSecret: true,
    },
    webSearch: {
      defaultProvider: "duckduckgo",
      timeoutMs: 15_000,
      maxResults: 10,
    },
  };
}

/**
 * Derive the write-tool allowlist from the final config's channel allowlists.
 * Returns null when no channel-level user IDs are present (= no restriction).
 */
export function deriveWriteToolAllowListFromConfig(config: AppConfig): string[] | null {
  const ids = new Set<string>();
  if (config.discord?.memberAllowList) {
    for (const id of config.discord.memberAllowList) ids.add(id);
  }
  if (config.telegram?.allowList) {
    for (const id of config.telegram.allowList) ids.add(id);
  }
  return ids.size > 0 ? [...ids] : null;
}

/**
 * MCP server presets available during onboarding.
 */
const MCP_PRESETS = [
  { name: "Playwright", description: "Browser automation via @playwright/mcp", config: playwrightServerConfig },
] as const;

/**
 * Prompt user to choose which MCP servers to enable.
 */
export async function configureMcpServers(
  rl: ReturnType<typeof createInterface>,
): Promise<AppConfig["mcp"] | undefined> {
  header("MCP Servers");
  info("MCP (Model Context Protocol) lets your bot use external tool servers.");
  info("Available presets:\n");

  const selected: (typeof MCP_PRESETS)[number]["config"][] = [];
  const securityOverrides: Record<string, { level: string; confirmRequired?: boolean }> = {};

  for (const preset of MCP_PRESETS) {
    const enable = await askYN(rl, `Enable ${preset.name}? (${preset.description})`, true);
    if (!enable) continue;

    selected.push(preset.config);

    // If user enables Playwright MCP, write the recommended security overrides
    // directly into app.yaml so runtime doesn't have to guess.
    if (preset.config.name === "playwright") {
      Object.assign(securityOverrides, playwrightSecurityOverrides);
    }
  }

  if (selected.length === 0) return undefined;

  return {
    servers: selected.map((s) => ({ ...s })),
    ...(Object.keys(securityOverrides).length > 0 ? { securityOverrides } : {}),
  };
}

export async function buildAppConfigFromPrompts(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
  providers: ProviderConfig[],
  _secrets: SecretsConfig,
  discordEnabled: boolean,
  telegramEnabled: boolean,
  reuseTelegramConfig?: boolean,
  telegramAllowList?: string[],
  telegramGroups?: NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>,
): Promise<{ config: AppConfig; workspacePath: string; writeToolAllowList: string[] | null }> {
  const workspace = await getWorkspacePath(rl, dockerMode, appConfigPath);
  const gateway = await getGatewayConfig(rl, dockerMode);

  const config: AppConfig = {
    workspace,
    providers,
    memorySearch: buildDefaultMemorySearchConfig(workspace),
    system: buildDefaultSystemConfig(),
    ...(gateway ? { gateway } : {}),
  };

  const userAllowLists: UserAllowLists = { discord: [], telegram: [] };
  if (discordEnabled) await configureDiscordConfig(rl, config, userAllowLists);

  if (telegramEnabled) {
    if (reuseTelegramConfig) {
      config.telegram = {
        ...config.telegram,
        ...(telegramAllowList && telegramAllowList.length > 0 && { allowList: telegramAllowList }),
        ...(telegramGroups && Object.keys(telegramGroups).length > 0 && { groups: telegramGroups }),
      };
      if (telegramAllowList) userAllowLists.telegram = telegramAllowList;
    } else {
      await configureTelegramConfig(rl, config, userAllowLists);
    }
  }

  // MCP servers
  const mcpConfig = await configureMcpServers(rl);
  if (mcpConfig) config.mcp = mcpConfig;

  // When MCP is enabled, auto-set security defaults so MCP tools (e.g. Playwright
  // screenshot) aren't blocked by WriteGate out of the box.
  // writeToolAllowList is NOT auto-set here — that's user-specific.
  if (mcpConfig) {
    config.security = {
      ...(config.security ?? {}),
      writeGateEnabled: true,
      writeToolConfirmation: false,
    };
  }

  const writeToolAllowList = await configureWriteToolsSecurity(rl, config, userAllowLists);

  return { config, workspacePath: workspace, writeToolAllowList };
}
