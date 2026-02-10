/**
 * Step module: detect existing configuration.
 */

import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { loadSecrets } from "../secrets.js";
import { ensureOwliabotHomeEnv } from "../../utils/paths.js";
import { info, success, header, askYN } from "../shared.js";
import type { DetectedConfig } from "./types.js";

export async function detectExistingConfig(
  _dockerMode: boolean,
  appConfigPath: string,
): Promise<DetectedConfig | null> {
  try {
    const existing = await loadSecrets(appConfigPath);
    if (!existing) return null;

    const result: DetectedConfig = {};
    let hasAny = false;

    if (existing.anthropic?.apiKey) { result.anthropicKey = existing.anthropic.apiKey; hasAny = true; }
    if (existing.anthropic?.token) { result.anthropicToken = existing.anthropic.token; hasAny = true; }
    if (existing.openai?.apiKey) { result.openaiKey = existing.openai.apiKey; hasAny = true; }
    if (existing["openai-compatible"]?.apiKey) { result.openaiCompatKey = existing["openai-compatible"].apiKey; hasAny = true; }
    if (existing.discord?.token) { result.discordToken = existing.discord.token; hasAny = true; }
    if (existing.telegram?.token) { result.telegramToken = existing.telegram.token; hasAny = true; }
    if (existing.gateway?.token) { result.gatewayToken = existing.gateway.token; hasAny = true; }

    const authDir = join(ensureOwliabotHomeEnv(), "auth");
    if (existsSync(join(authDir, "anthropic.json"))) { result.anthropicOAuth = true; hasAny = true; }
    if (existsSync(join(authDir, "openai-codex.json"))) { result.openaiOAuth = true; hasAny = true; }

    return hasAny ? result : null;
  } catch {
    return null;
  }
}

export function printExistingConfigSummary(
  dockerMode: boolean,
  appConfigPath: string,
  existing: DetectedConfig,
): void {
  header("Existing configuration found");
  info(`Found existing config at: ${dirname(appConfigPath)}`);

  if (existing.anthropicKey) {
    const truncLen = dockerMode ? 10 : 15;
    info(`Found Anthropic API key: ${existing.anthropicKey.slice(0, truncLen)}...`);
  }
  if (existing.anthropicToken) info("Found Anthropic setup-token");
  if (dockerMode && existing.anthropicOAuth) info("Found Anthropic OAuth token");
  if (existing.openaiKey) info(`Found OpenAI API key: ${existing.openaiKey.slice(0, 10)}...`);
  if (dockerMode && existing.openaiOAuth) info("Found OpenAI OAuth token (openai-codex)");
  if (existing.discordToken) info(`Found Discord token: ${existing.discordToken.slice(0, 20)}...`);
  if (existing.telegramToken) info(`Found Telegram token: ${existing.telegramToken.slice(0, 10)}...`);
  if (dockerMode && existing.gatewayToken) info(`Found Gateway token: ${existing.gatewayToken.slice(0, 10)}...`);
}

export async function promptReuseExistingConfig(
  rl: ReturnType<typeof createInterface>,
  existing: DetectedConfig | null,
): Promise<boolean> {
  if (!existing) return false;

  const reuse = await askYN(rl, "Do you want to reuse existing configuration?", true);
  if (reuse) success("Will reuse existing configuration");
  else info("Will configure new credentials");
  return reuse;
}
