/**
 * Shared types for onboarding step modules.
 */

import type { ProviderConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import type { ExistingConfig } from "../shared.js";
import type { AppConfig } from "../types.js";

export interface DetectedConfig extends ExistingConfig {
  openaiCompatKey?: string;
  hasOAuthAnthro?: boolean;
  hasOAuthCodex?: boolean;
  oauthCodexExpires?: number;
  anthropicTokenValid?: boolean;
  discordMemberAllowList?: string[];
  telegramAllowList?: string[];
  telegramGroups?: NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;
}

export interface OnboardOptions {
  /** Path for app.yaml in dev mode */
  appConfigPath?: string;
  /** Enable Docker-aware mode */
  docker?: boolean;
  /** Config output directory (docker mode) */
  configDir?: string;
  /** Output directory for docker-compose.yml (docker mode) */
  outputDir?: string;
}

export interface ProviderResult {
  providers: ProviderConfig[];
  secrets: SecretsConfig;
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

export interface ProviderSetupState {
  providers: ProviderConfig[];
  secrets: SecretsConfig;
  priority: number;
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

export interface ChannelResult {
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordToken: string;
  telegramToken: string;
  reuseTelegramConfig?: boolean;
  telegramAllowList?: string[];
  telegramGroups?: NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;
}

/** @deprecated Use ChannelResult instead */
export type ChannelsSetup = ChannelResult;

// DockerPaths is defined in docker.ts and re-exported from index.ts

export interface DockerGatewaySetup {
  gatewayToken: string;
  gatewayPort: string;
  tz: string;
}

export type UserAllowLists = { discord: string[]; telegram: string[] };
