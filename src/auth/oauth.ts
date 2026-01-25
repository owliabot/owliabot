/**
 * OAuth flow for Claude subscription
 * @see design.md DR-007
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import open from "open";
import { createLogger } from "../utils/logger.js";
import type { AuthToken, AuthStore } from "./store.js";

const log = createLogger("oauth");

// Claude OAuth endpoints (same as Claude CLI)
const OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL = "https://claude.ai/oauth/token";
const CLIENT_ID = "owliabot";
const REDIRECT_PORT = 19275;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export interface OAuthOptions {
  store: AuthStore;
}

export async function startOAuthFlow(options: OAuthOptions): Promise<AuthToken> {
  const { store } = options;

  // Generate state for CSRF protection
  const state = generateRandomString(32);

  // Start local server to receive callback
  const code = await waitForCallback(state);

  // Exchange code for token
  const token = await exchangeCodeForToken(code);

  // Save token
  await store.save(token);

  return token;
}

async function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400);
        res.end(`Authentication failed: ${error}`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400);
        res.end("Invalid state parameter");
        server.close();
        reject(new Error("Invalid OAuth state"));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end("Missing authorization code");
        server.close();
        reject(new Error("Missing authorization code"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1>Authentication Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
          </body>
        </html>
      `);

      server.close();
      resolve(code);
    });

    server.listen(REDIRECT_PORT, () => {
      log.info(`OAuth callback server listening on port ${REDIRECT_PORT}`);
      log.info("Opening browser for authentication...");

      const authUrl = new URL(OAUTH_AUTHORIZE_URL);
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("state", expectedState);
      authUrl.searchParams.set("scope", "messages:write");

      open(authUrl.toString());
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout - no callback received"));
    }, 5 * 60 * 1000);
  });
}

async function exchangeCodeForToken(code: string): Promise<AuthToken> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
  };
}

export async function refreshToken(
  token: AuthToken,
  store: AuthStore
): Promise<AuthToken> {
  log.info("Refreshing OAuth token...");

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  const newToken: AuthToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
  };

  await store.save(newToken);
  log.info("Token refreshed successfully");

  return newToken;
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
