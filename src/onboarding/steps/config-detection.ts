/**
 * Existing configuration detection
 */

import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as yamlParse } from "yaml";
import { loadSecrets } from "../secrets.js";
import { ensureOwliabotHomeEnv } from "../../utils/paths.js";
import type { AppConfig } from "../types.js";

type TelegramGroups = NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;

export interface DetectedConfig {
  anthropicKey?: string;
  anthropicToken?: string;
  openaiKey?: string;
  openaiCompatKey?: string;
  discordToken?: string;
  telegramToken?: string;
  gatewayToken?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
}

/**
 * Detect existing configuration for both dev and docker modes.
 * Implementation uses the same method for both modes: load secrets.yaml via the
 * secrets loader + check OAuth auth files.
 */
export async function detectExistingConfig(
  _dockerMode: boolean,
  appConfigPath: string,
): Promise<DetectedConfig | null> {
  try {
    const result: DetectedConfig = {};
    let hasAny = false;

    // Both modes: load via secrets loader.
    // Caller should pass an appConfigPath whose sibling secrets.yaml is the desired
    // secrets location (local mode: config dir; docker mode: configDir).
    const secrets = await loadSecrets(appConfigPath);
    if (secrets) {
      if (secrets.anthropic?.apiKey) { result.anthropicKey = secrets.anthropic.apiKey; hasAny = true; }
      if (secrets.anthropic?.token) { result.anthropicToken = secrets.anthropic.token; hasAny = true; }
      if (secrets.openai?.apiKey) { result.openaiKey = secrets.openai.apiKey; hasAny = true; }
      if (secrets["openai-compatible"]?.apiKey) { result.openaiCompatKey = secrets["openai-compatible"].apiKey; hasAny = true; }
      if (secrets.discord?.token) { result.discordToken = secrets.discord.token; hasAny = true; }
      if (secrets.telegram?.token) { result.telegramToken = secrets.telegram.token; hasAny = true; }
      if (secrets.gateway?.token) { result.gatewayToken = secrets.gateway.token; hasAny = true; }

      // Check OAuth tokens (same location for both modes).
      // Keep prior behavior: only check OAuth when secrets.yaml exists to avoid
      // surprising prompts in test/CI environments.
      const authDir = join(ensureOwliabotHomeEnv(), "auth");
      if (existsSync(join(authDir, "anthropic.json"))) { result.anthropicOAuth = true; hasAny = true; }
      if (existsSync(join(authDir, "openai-codex.json"))) { result.openaiOAuth = true; hasAny = true; }
    }

    // Best-effort: detect Telegram allowList/groups from app.yaml so we can offer reuse.
    try {
      if (existsSync(appConfigPath)) {
        const raw = yamlParse(readFileSync(appConfigPath, "utf-8")) as any;
        const tg = raw?.telegram;
        if (tg && typeof tg === "object") {
          const allowList = Array.isArray(tg.allowList)
            ? tg.allowList.map((v: unknown) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
            : [];
          if (allowList.length > 0) {
            result.telegramAllowList = allowList;
            hasAny = true;
          }

          const groups = tg.groups && typeof tg.groups === "object"
            ? (tg.groups as TelegramGroups)
            : undefined;
          if (groups && Object.keys(groups).length > 0) {
            result.telegramGroups = groups;
            hasAny = true;
          }

          // If the user stored the token directly in app.yaml, treat it as an existing token
          // for reuse prompts. Ignore env placeholders like "${TELEGRAM_BOT_TOKEN}" so we
          // don't copy them into secrets.yaml and break env-based Docker setups.
          if (!result.telegramToken && typeof tg.token === "string") {
            const token = tg.token.trim();
            const isEnvPlaceholder = token.startsWith("${") && token.endsWith("}");
            if (token.length > 0 && !isEnvPlaceholder) {
              result.telegramToken = token;
              hasAny = true;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // Keep behavior parity: only return non-empty.
    return hasAny ? result : null;
  } catch {
    return null;
  }
}
