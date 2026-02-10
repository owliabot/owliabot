/**
 * UI utilities for onboarding (banners, prompts, summaries)
 */

import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { IS_DEV_MODE } from "../storage.js";
import type { SecretsConfig } from "../secrets.js";
import { printBanner, info, success, header, askYN } from "../shared.js";
import type { DetectedConfig } from "./config-detection.js";
import type { createInterface } from "node:readline";

type RL = ReturnType<typeof createInterface>;

/**
 * Print onboarding banner.
 */
export function printOnboardingBanner(dockerMode: boolean): void {
  if (dockerMode) {
    printBanner("(Docker)");
    return;
  }

  printBanner(IS_DEV_MODE ? "(dev mode)" : "");
  if (IS_DEV_MODE) {
    info("Dev mode is on (OWLIABOT_DEV=1). I'll save settings to ~/.owlia_dev/.");
  }
}

/**
 * Print summary of existing configuration.
 */
export function printExistingConfigSummary(
  dockerMode: boolean,
  appConfigPath: string,
  existing: DetectedConfig,
): void {
  header("I found an existing setup");
  info(`Settings folder: ${dirname(appConfigPath)}`);

  if (existing.anthropicKey) {
    const truncLen = dockerMode ? 10 : 15;
    info(`Anthropic: API key is set (${existing.anthropicKey.slice(0, truncLen)}...)`);
  }
  if (existing.anthropicToken) info("Anthropic: setup-token is set");
  if (dockerMode && existing.anthropicOAuth) info("Anthropic: OAuth token is present");
  if (existing.openaiKey) info(`OpenAI: API key is set (${existing.openaiKey.slice(0, 10)}...)`);
  if (dockerMode && existing.openaiOAuth) info("OpenAI Codex: OAuth token is present");
  if (existing.discordToken) info(`Discord: token is set (${existing.discordToken.slice(0, 20)}...)`);
  if (existing.telegramToken) info(`Telegram: token is set (${existing.telegramToken.slice(0, 10)}...)`);
  if (dockerMode && existing.gatewayToken) info(`Gateway: token is set (${existing.gatewayToken.slice(0, 10)}...)`);
}

/**
 * Prompt whether to reuse existing configuration.
 */
export async function promptReuseExistingConfig(
  rl: RL,
  existing: DetectedConfig | null,
): Promise<boolean> {
  if (!existing) return false;

  const reuse = await askYN(rl, "Want to keep using these settings?", true);
  if (reuse) success("Great. I'll keep your existing settings.");
  else info("Okay. We'll set things up fresh.");
  return reuse;
}

/**
 * Ensure gateway token exists (create or reuse).
 */
export function ensureGatewayToken(
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): string {
  // Always provision a gateway token when generating config.
  // If a token already exists and the user opted to reuse config, keep it stable.
  const reused = reuseExisting && existing?.gatewayToken ? existing.gatewayToken : "";
  const token = secrets.gateway?.token || reused || randomBytes(16).toString("hex");
  secrets.gateway = { token };
  return token;
}
