/**
 * Auth token storage
 * @see design.md DR-007
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("auth-store");

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  tokenType: string;
}

export interface AuthStore {
  get(): Promise<AuthToken | null>;
  save(token: AuthToken): Promise<void>;
  clear(): Promise<void>;
  isExpired(token: AuthToken): boolean;
  needsRefresh(token: AuthToken): boolean;
}

export function createAuthStore(authDir: string): AuthStore {
  const authPath = join(authDir, "auth.json");

  return {
    async get(): Promise<AuthToken | null> {
      try {
        const content = await readFile(authPath, "utf-8");
        return JSON.parse(content) as AuthToken;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    },

    async save(token: AuthToken): Promise<void> {
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify(token, null, 2));
      log.info("Auth token saved");
    },

    async clear(): Promise<void> {
      try {
        await writeFile(authPath, "");
        log.info("Auth token cleared");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    },

    isExpired(token: AuthToken): boolean {
      return Date.now() >= token.expiresAt;
    },

    needsRefresh(token: AuthToken): boolean {
      // Refresh 5 minutes before expiry
      const refreshBuffer = 5 * 60 * 1000;
      return Date.now() >= token.expiresAt - refreshBuffer;
    },
  };
}
