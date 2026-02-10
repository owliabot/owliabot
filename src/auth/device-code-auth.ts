/**
 * OpenAI Device Code Authentication
 *
 * Implements the OAuth 2.0 Device Authorization Grant flow for OpenAI,
 * replacing the browser-based pi-ai dependency. Works in headless/SSH environments.
 *
 * Flow: request user code → user visits URL & enters code → poll for completion → exchange for tokens
 *
 * @see https://auth.openai.com/codex/device
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("device-code-auth");

// ── Constants ──────────────────────────────────────────────────────────────────

export const AUTH_BASE_URL = "https://auth.openai.com";
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const VERIFICATION_URL = `${AUTH_BASE_URL}/codex/device`;
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DeviceCodeResponse {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  interval: number;
}

export interface DeviceCodeCompletion {
  authorizationCode: string;
  codeChallenge: string;
  codeVerifier: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
}

// ── Step 1: Request Device Code ────────────────────────────────────────────────

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to request device code: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    device_auth_id: string;
    user_code: string;
    interval: string;
  };

  return {
    verificationUrl: VERIFICATION_URL,
    userCode: data.user_code,
    deviceAuthId: data.device_auth_id,
    interval: parseInt(data.interval, 10) || 5,
  };
}

// ── Step 2: Poll for Completion ────────────────────────────────────────────────

export async function pollForDeviceCodeCompletion(
  deviceAuthId: string,
  userCode: string,
  interval: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DeviceCodeCompletion> {
  const deadline = Date.now() + timeoutMs;
  let firstPoll = true;

  while (Date.now() < deadline) {
    // Sleep between retries, but poll immediately on first attempt
    if (firstPoll) {
      firstPoll = false;
    } else {
      await sleep(interval * 1000);
    }

    const res = await fetch(
      `${AUTH_BASE_URL}/api/accounts/deviceauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_auth_id: deviceAuthId,
          user_code: userCode,
        }),
      },
    );

    if (res.ok) {
      const data = (await res.json()) as {
        authorization_code: string;
        code_challenge: string;
        code_verifier: string;
      };
      return {
        authorizationCode: data.authorization_code,
        codeChallenge: data.code_challenge,
        codeVerifier: data.code_verifier,
      };
    }

    // 403 or 404 means "still pending" — keep polling
    if (res.status === 403 || res.status === 404) {
      const body = await res.text().catch(() => "");
      log.debug(`Polling... (${res.status}${body ? `: ${body}` : ""})`);
      continue;
    }

    // Unexpected error
    const text = await res.text().catch(() => "");
    throw new Error(`Unexpected polling response: ${res.status} ${text}`);
  }

  throw new Error("Device code authentication timed out (15 minutes)");
}

// ── Step 3: Exchange Code for Tokens ───────────────────────────────────────────

export async function exchangeDeviceCodeForTokens(
  authorizationCode: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const res = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: `${AUTH_BASE_URL}/deviceauth/callback`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to exchange code for tokens: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ── Refresh Tokens ─────────────────────────────────────────────────────────────

export async function refreshDeviceCodeTokens(
  refreshToken: string,
): Promise<OAuthTokens> {
  const res = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to refresh token: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ── Full Login Flow ────────────────────────────────────────────────────────────

/**
 * Run the complete device code login flow:
 * 1. Request device code
 * 2. Print user instructions
 * 3. Poll for completion
 * 4. Exchange for tokens
 */
export async function runDeviceCodeLogin(): Promise<OAuthTokens> {
  // Step 1: Request code
  const { verificationUrl, userCode, deviceAuthId, interval } =
    await requestDeviceCode();

  // Step 2: Show instructions
  console.log();
  console.log("🔐 OpenAI Device Code Login");
  console.log();
  console.log("Open this URL in your browser and sign in:");
  console.log(`  ${verificationUrl}`);
  console.log();
  console.log("Then enter this one-time code (valid for 15 minutes):");
  console.log(`  ${userCode}`);
  console.log();
  console.log("⚠️ Do not share this code.");
  console.log();
  console.log("Waiting for verification...");

  // Step 3: Poll
  const { authorizationCode, codeVerifier } =
    await pollForDeviceCodeCompletion(deviceAuthId, userCode, interval);

  // Step 4: Exchange
  const tokens = await exchangeDeviceCodeForTokens(
    authorizationCode,
    codeVerifier,
  );

  log.info("Device code authentication successful");
  return tokens;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
