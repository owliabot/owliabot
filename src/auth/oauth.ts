/**
 * OAuth flow for LLM providers using pi-ai
 * 
 * Currently supports:
 * - OpenAI Codex (ChatGPT Plus/Pro)
 * 
 * Note: Anthropic authentication now uses setup-token from `claude setup-token`
 * instead of the deprecated pi-ai OAuth flow. See setup-token.ts for details.
 * 
 * @see design.md DR-007
 */

import {
  loginOpenAICodex,
  refreshOpenAICodexToken,
  type OAuthCredentials,
} from "@mariozechner/pi-ai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import open from "open";
import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";

const log = createLogger("oauth");

/** Supported OAuth provider types for owliabot (Anthropic removed - use setup-token) */
export type SupportedOAuthProvider = "openai-codex";

const AUTH_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".owliabot",
  "auth"  // Save auth files in auth/ subdirectory for proper Docker volume mounting
);

/** Get auth file path for a specific provider */
function getAuthFile(provider: SupportedOAuthProvider): string {
  return join(AUTH_DIR, `auth-${provider}.json`);
}

/**
 * Start OAuth flow for a provider
 * @param provider - 'openai-codex'
 */
export async function startOAuthFlow(
  provider: SupportedOAuthProvider = "openai-codex"
): Promise<OAuthCredentials> {
  log.info(`Starting ${provider} OAuth flow...`);

  let credentials: OAuthCredentials;

  if (provider === "openai-codex") {
    credentials = await loginOpenAICodex({
      onAuth: (info) => {
        log.info("Opening browser for OpenAI Codex authentication...");
        log.info(`If browser doesn't open, visit: ${info.url}`);
        if (info.instructions) {
          log.info(info.instructions);
        }
        open(info.url);
      },
      onPrompt: async (prompt) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        return new Promise<string>((resolve) => {
          rl.question(prompt.message + " ", (code) => {
            rl.close();
            resolve(code.trim());
          });
        });
      },
      onProgress: (message) => {
        log.debug(message);
      },
    });
  } else {
    throw new Error(`Unsupported OAuth provider: ${provider}. For Anthropic, use setup-token instead.`);
  }

  // Save credentials
  await saveOAuthCredentials(credentials, provider);

  log.info(`${provider} authentication successful!`);
  return credentials;
}

/**
 * Refresh OAuth token for a provider
 */
export async function refreshOAuthCredentials(
  credentials: OAuthCredentials,
  provider: SupportedOAuthProvider = "openai-codex"
): Promise<OAuthCredentials> {
  log.info(`Refreshing ${provider} OAuth token...`);

  let newCredentials: OAuthCredentials;

  if (provider === "openai-codex") {
    newCredentials = await refreshOpenAICodexToken(credentials.refresh);
  } else {
    throw new Error(`Unsupported OAuth provider: ${provider}. For Anthropic, use setup-token instead.`);
  }

  // Save new credentials
  await saveOAuthCredentials(newCredentials, provider);

  log.info(`${provider} token refreshed successfully`);
  return newCredentials;
}

/**
 * Load saved OAuth credentials for a provider
 */
export async function loadOAuthCredentials(
  provider: SupportedOAuthProvider = "openai-codex"
): Promise<OAuthCredentials | null> {
  const authFile = getAuthFile(provider);

  try {
    const content = await readFile(authFile, "utf-8");
    const data = JSON.parse(content) as OAuthCredentials;

    // Check if expired
    if (Date.now() >= data.expires) {
      log.debug(`${provider} OAuth token expired, needs refresh`);
      // Auto-refresh
      try {
        return await refreshOAuthCredentials(data, provider);
      } catch (err) {
        log.warn(`${provider} token refresh failed, need re-authentication`);
        return null;
      }
    }

    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    return null;
  }
}

/**
 * Save OAuth credentials for a provider
 */
export async function saveOAuthCredentials(
  credentials: OAuthCredentials,
  provider: SupportedOAuthProvider = "openai-codex"
): Promise<void> {
  const authFile = getAuthFile(provider);
  await mkdir(dirname(authFile), { recursive: true });
  await writeFile(authFile, JSON.stringify(credentials, null, 2));
  log.debug(`${provider} credentials saved to ${authFile}`);
}

/**
 * Clear saved OAuth credentials for a provider
 */
export async function clearOAuthCredentials(
  provider: SupportedOAuthProvider = "openai-codex"
): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  const authFile = getAuthFile(provider);

  // Delete auth file
  try {
    await unlink(authFile);
    log.info(`${provider} credentials cleared`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

/**
 * Check OAuth status for a provider
 */
export async function getOAuthStatus(
  provider: SupportedOAuthProvider = "openai-codex"
): Promise<{
  authenticated: boolean;
  expiresAt?: number;
  email?: string;
}> {
  const credentials = await loadOAuthCredentials(provider);

  if (!credentials) {
    return { authenticated: false };
  }

  const email =
    typeof credentials.email === "string" ? credentials.email : undefined;

  return {
    authenticated: true,
    expiresAt: credentials.expires,
    email,
  };
}

/**
 * Get OAuth status for all supported providers
 */
export async function getAllOAuthStatus(): Promise<
  Record<
    SupportedOAuthProvider,
    { authenticated: boolean; expiresAt?: number; email?: string }
  >
> {
  const providers: SupportedOAuthProvider[] = ["openai-codex"];
  const result = {} as Record<
    SupportedOAuthProvider,
    { authenticated: boolean; expiresAt?: number; email?: string }
  >;

  for (const provider of providers) {
    result[provider] = await getOAuthStatus(provider);
  }

  return result;
}
