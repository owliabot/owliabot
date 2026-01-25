/**
 * Claude CLI token reader
 * @see design.md DR-007
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthToken } from "./store.js";

const CLAUDE_CLI_CREDENTIALS_PATH = join(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
  ".claude",
  ".credentials.json"
);

export function loadClaudeCliToken(): AuthToken | null {
  try {
    const content = readFileSync(CLAUDE_CLI_CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(content);
    const oauth = data.claudeAiOauth;

    if (!oauth?.accessToken) return null;

    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      tokenType: "Bearer",
    };
  } catch {
    return null;
  }
}

export function isClaudeCliAuthenticated(): boolean {
  const token = loadClaudeCliToken();
  return token !== null && Date.now() < token.expiresAt;
}
