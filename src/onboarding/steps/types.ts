/**
 * Shared types for onboarding step modules.
 */

import type { ProviderConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import type { ExistingConfig } from "../shared.js";
import type { AppConfig } from "../types.js";

export interface DetectedConfig extends ExistingConfig {
  openaiCompatKey?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
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
}

export interface ChannelsSetup {
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordToken: string;
  telegramToken: string;
}

export interface DockerPaths {
  /** Host directory where we write app.yaml + secrets.yaml */
  configDir: string;
  /** Original configDir option (may be a container path like /app/config) */
  containerConfigDir: string;
  dockerConfigPath: string;
  shellConfigPath: string;
  outputDir: string;
}

export interface DockerGatewaySetup {
  gatewayToken: string;
  gatewayPort: string;
  tz: string;
}

export type UserAllowLists = { discord: string[]; telegram: string[] };
