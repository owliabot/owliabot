/**
 * OAuth flow for LLM providers using Device Code authentication
 *
 * Currently supports:
 * - OpenAI Codex (ChatGPT Plus/Pro) via Device Code flow
 *
 * Note: Anthropic authentication now uses setup-token from `claude setup-token`
 * instead of the deprecated pi-ai OAuth flow. See setup-token.ts for details.
 *
 * @see design.md DR-007
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createLogger } from "../utils/logger.js";
import { ensureOwliabotHomeEnv } from "../utils/paths.js";
import {
  runDeviceCodeLogin,
  refreshDeviceCodeTokens,
  type OAuthTokens,
} from "./device-code-auth.js";

const log = createLogger("oauth");

/** Supported OAuth provider types for owliabot (Anthropic removed - use setup-token) */
export type SupportedOAuthProvider = "openai-codex";

/**
 * Credentials shape stored on disk.
 * Compatible with the OAuthCredentials interface from pi-ai 0.52+.
 */
export interface OAuthCredentials {
  access: string;
  refresh: string;
  idToken?: string;
  expires: number;
  enterpriseUrl?: string;
  projectId?: string;
  email?: string;
  accountId?: string;
  [key: string]: unknown;
}

const AUTH_DIR = join(
  ensureOwliabotHomeEnv(),
  "auth",
);

/** Get auth file path for a specific provider */
function getAuthFile(provider: SupportedOAuthProvider): string {
  return join(AUTH_DIR, `auth-${provider}.json`);
}

/** Convert internal OAuthTokens to stored OAuthCredentials */
function tokensToCredentials(tokens: OAuthTokens): OAuthCredentials {
  return {
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    idToken: tokens.idToken,
    expires: tokens.expiresAt,
  };
}

/**
 * Start OAuth flow for a provider using Device Code authentication.
 * Works in headless/SSH environments - no browser callback needed.
 *
 * @param provider - 'openai-codex'
 */
export async function startOAuthFlow(
  provider: SupportedOAuthProvider = "openai-codex",
  _options?: { headless?: boolean },
): Promise<OAuthCredentials> {
  log.info(`Starting ${provider} OAuth flow (device code)...`);

  if (provider !== "openai-codex") {
    throw new Error(
      `Unsupported OAuth provider: ${provider}. For Anthropic, use setup-token instead.`,
    );
  }

  const tokens = await runDeviceCodeLogin();
  const credentials = tokensToCredentials(tokens);

  await saveOAuthCredentials(credentials, provider);
  log.info(`${provider} authentication successful!`);
  return credentials;
}

/**
 * Refresh OAuth token for a provider
 */
export async function refreshOAuthCredentials(
  credentials: OAuthCredentials,
  provider: SupportedOAuthProvider = "openai-codex",
): Promise<OAuthCredentials> {
  log.info(`Refreshing ${provider} OAuth token...`);

  if (provider !== "openai-codex") {
    throw new Error(
      `Unsupported OAuth provider: ${provider}. For Anthropic, use setup-token instead.`,
    );
  }

  const tokens = await refreshDeviceCodeTokens(credentials.refresh);
  const newCredentials = tokensToCredentials(tokens);

  await saveOAuthCredentials(newCredentials, provider);
  log.info(`${provider} token refreshed successfully`);
  return newCredentials;
}

/**
 * Load saved OAuth credentials for a provider
 */
export async function loadOAuthCredentials(
  provider: SupportedOAuthProvider = "openai-codex",
): Promise<OAuthCredentials | null> {
  const authFile = getAuthFile(provider);

  try {
    const content = await readFile(authFile, "utf-8");
    const data = JSON.parse(content) as OAuthCredentials;

    // Check if expired
    if (Date.now() >= data.expires) {
      log.debug(`${provider} OAuth token expired, needs refresh`);
      try {
        return await refreshOAuthCredentials(data, provider);
      } catch {
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
  provider: SupportedOAuthProvider = "openai-codex",
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
  provider: SupportedOAuthProvider = "openai-codex",
): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  const authFile = getAuthFile(provider);

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
  provider: SupportedOAuthProvider = "openai-codex",
): Promise<{
  authenticated: boolean;
  expiresAt?: number;
  email?: string;
}> {
  const credentials = await loadOAuthCredentials(provider);

  if (!credentials) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    expiresAt: credentials.expires,
    email: credentials.email,
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
