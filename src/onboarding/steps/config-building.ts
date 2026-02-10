/**
 * Step module: config building from prompts.
 */

import { createInterface } from "node:readline";
import { join } from "node:path";
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { header } from "../shared.js";
import { getWorkspacePath } from "./workspace-setup.js";
import { getGatewayConfig } from "./gateway-setup.js";
import { configureDiscordConfig } from "./configure-discord.js";
import { configureTelegramConfig } from "./configure-telegram.js";
import { configureWallet } from "./configure-wallet.js";
import { configureWriteToolsSecurity } from "./security-setup.js";
import type { UserAllowLists } from "./types.js";

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

export async function buildAppConfigFromPrompts(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
  providers: ProviderConfig[],
  secrets: SecretsConfig,
  discordEnabled: boolean,
  telegramEnabled: boolean,
): Promise<{ config: AppConfig; workspace: string; writeToolAllowList: string[] | null }> {
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
  if (telegramEnabled) await configureTelegramConfig(rl, config, userAllowLists);

  await configureWallet(rl, secrets, config);
  const writeToolAllowList = await configureWriteToolsSecurity(rl, config, userAllowLists);

  return { config, workspace, writeToolAllowList };
}
