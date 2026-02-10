/**
 * Shared types for onboarding step modules.
 */

import type { ProviderConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import type { ExistingConfig } from "../shared.js";
import type { AppConfig } from "../types.js";

type TelegramGroups = NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;

export interface DetectedConfig extends ExistingConfig {
  openaiCompatKey?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
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
  telegramGroups?: TelegramGroups;
}

/** @deprecated Use ChannelResult instead */
export type ChannelsSetup = ChannelResult;

export interface DockerGatewaySetup {
  gatewayToken: string;
  gatewayPort: string;
  tz: string;
}

export type UserAllowLists = { discord: string[]; telegram: string[] };
