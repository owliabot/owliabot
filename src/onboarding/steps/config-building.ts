/**
 * Build AppConfig from onboarding prompts
 */

import { dirname, join } from "node:path";
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { runClawletOnboarding } from "../clawlet-onboard.js";
import {
  configureDiscordConfig,
  configureTelegramConfig,
  type DetectedConfig,
} from "./channel-setup.js";
import type { createInterface } from "node:readline";

type RL = ReturnType<typeof createInterface>;
type TelegramGroups = NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;

/**
 * Build default memory search configuration.
 */
export function buildDefaultMemorySearchConfig(): MemorySearchConfig {
  // Use {workspace} placeholder so the store path resolves correctly even when
  // config.workspace is a relative path.
  return {
    enabled: true,
    provider: "sqlite",
    fallback: "naive",
    store: {
      path: "{workspace}/memory/{agentId}.sqlite",
    },
    extraPaths: [],
    sources: ["files"],
    indexing: {
      autoIndex: true,
      minIntervalMs: 5 * 60 * 1000,
    },
  };
}

/**
 * Build default system capability configuration.
 */
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
 * Get gateway configuration.
 */
export async function getGatewayConfig(
  rl: RL,
  dockerMode: boolean,
): Promise<AppConfig["gateway"] | undefined> {
  void rl; // gateway config is always enabled; no prompts
  return {
    http: {
      host: dockerMode ? "0.0.0.0" : "127.0.0.1",
      port: 8787,
      token: "secrets",
      // Strict by default in local mode. In docker mode, the compose template
      // binds the published port to 127.0.0.1 on the host.
      ...(dockerMode ? {} : { allowlist: ["127.0.0.1"] }),
    },
  };
}

/**
 * Configure wallet integration.
 */
export async function configureWallet(
  rl: RL,
  secrets: SecretsConfig,
  config: AppConfig,
): Promise<void> {
  const walletConfig = await runClawletOnboarding(rl, secrets);
  if (!walletConfig.enabled) return;

  config.wallet = {
    clawlet: {
      enabled: true,
      baseUrl: walletConfig.baseUrl,
      requestTimeout: 30000,
      defaultChainId: walletConfig.defaultChainId,
      defaultAddress: walletConfig.defaultAddress,
    },
  };
}

/**
 * Build AppConfig from interactive prompts.
 */
export async function buildAppConfigFromPrompts(
  rl: RL,
  dockerMode: boolean,
  appConfigPath: string,
  providers: ProviderConfig[],
  secrets: SecretsConfig,
  discordEnabled: boolean,
  telegramEnabled: boolean,
  reuseTelegramConfig: boolean,
  telegramAllowList: string[] | undefined,
  telegramGroups: TelegramGroups | undefined,
): Promise<{ config: AppConfig; workspacePath: string; writeToolAllowList: string[] | null }> {
  // Keep local + docker onboarding aligned: workspace is always created next to app.yaml
  // and referenced via a relative path for portability.
  const workspace = "workspace";
  const workspacePath = join(dirname(appConfigPath), workspace);
  const gateway = await getGatewayConfig(rl, dockerMode);

  const config: AppConfig = {
    workspace,
    providers,
    memorySearch: buildDefaultMemorySearchConfig(),
    system: buildDefaultSystemConfig(),
    ...(gateway ? { gateway } : {}),
  };

  type UserAllowLists = { discord: string[]; telegram: string[] };
  const userAllowLists: UserAllowLists = { discord: [], telegram: [] };
  
  if (discordEnabled) await configureDiscordConfig(rl, config, userAllowLists);
  if (telegramEnabled) {
    if (reuseTelegramConfig) {
      const allowList = (telegramAllowList ?? []).map((s) => s.trim()).filter(Boolean);
      userAllowLists.telegram = allowList;
      config.telegram = {
        ...(allowList.length > 0 && { allowList }),
        ...(telegramGroups && Object.keys(telegramGroups).length > 0 && { groups: telegramGroups }),
      };
    } else {
      await configureTelegramConfig(rl, config, userAllowLists);
    }
  }

  await configureWallet(rl, secrets, config);

  // Auto-derive writeToolAllowList from channel allowlists (no interactive prompt).
  const allUserIds = [...new Set([...userAllowLists.discord, ...userAllowLists.telegram])];
  const writeToolAllowList = allUserIds.length > 0 ? allUserIds : null;
  if (writeToolAllowList) {
    config.tools = {
      ...(config.tools ?? {}),
      allowWrite: true,
    };
    config.security = {
      writeGateEnabled: false,
      writeToolAllowList,
      writeToolConfirmation: false,
    };
  }

  return { config, workspacePath, writeToolAllowList };
}

/**
 * Derive writeToolAllowList from existing config.
 */
export function deriveWriteToolAllowListFromConfig(config: AppConfig): string[] | null {
  const sec = (config as any).security as { writeToolAllowList?: unknown } | undefined;
  const fromSecurity = sec?.writeToolAllowList;
  if (Array.isArray(fromSecurity) && fromSecurity.length > 0) {
    return fromSecurity.filter((v) => typeof v === "string" && v.trim().length > 0);
  }

  // Fallback: if writeToolAllowList wasn't set (e.g. reused config path),
  // derive IDs from channel allowlists.
  const ids = new Set<string>();
  const discord = (config as any).discord as { memberAllowList?: unknown } | undefined;
  const telegram = (config as any).telegram as { allowList?: unknown } | undefined;

  if (Array.isArray(discord?.memberAllowList)) {
    for (const v of discord.memberAllowList) {
      if (typeof v === "string" && v.trim()) ids.add(v.trim());
    }
  }
  if (Array.isArray(telegram?.allowList)) {
    for (const v of telegram.allowList) {
      if (typeof v === "string" && v.trim()) ids.add(v.trim());
    }
  }

  return ids.size > 0 ? [...ids] : null;
}
