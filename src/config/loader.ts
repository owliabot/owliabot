/**
 * Config loader with environment variable expansion
 */

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { resolve, dirname, join } from "node:path";
import { configSchema, type Config } from "./schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("config");

export async function loadConfig(path: string): Promise<Config> {
  // Expand leading ~ (HOME)
  // - "~/x" => "$HOME/x"
  // - "~"   => "$HOME"
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const expandedPath =
    path === "~"
      ? home
      : path.startsWith("~/")
        ? resolve(home, path.slice(2))
        : path;

  log.info(`Loading config from ${expandedPath}`);

  const content = await readFile(expandedPath, "utf-8");
  const raw = parse(content) as any;

  // Resolve workspace path relative to config file
  const configDir = dirname(resolve(expandedPath));

  // Load secrets from same directory (optional): ~/.owlia_dev/secrets.yaml
  // This allows onboarding to keep tokens out of app.yaml while still satisfying schemas.
  const secretsPath = join(configDir, "secrets.yaml");
  let secrets: any = null;
  try {
    const secretsContent = await readFile(secretsPath, "utf-8");
    secrets = parse(secretsContent) as any;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  // Merge secrets/env tokens into raw config (before env expansion + schema validation)
  if (raw?.discord && !raw.discord.token) {
    raw.discord.token =
      secrets?.discord?.token ?? process.env.DISCORD_BOT_TOKEN ?? undefined;
  }
  if (raw?.telegram && !raw.telegram.token) {
    raw.telegram.token =
      secrets?.telegram?.token ?? process.env.TELEGRAM_BOT_TOKEN ?? undefined;
  }

  // Expand environment variables
  const expanded = expandEnvVars(raw);

  // Validate with Zod
  const config = configSchema.parse(expanded);

  config.workspace = resolve(configDir, config.workspace);
  log.debug(`Resolved workspace path: ${config.workspace}`);

  log.info("Config loaded successfully");
  return config;
}

function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}
