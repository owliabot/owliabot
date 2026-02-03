/**
 * Config loader with environment variable expansion
 */

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { resolve, dirname } from "node:path";
import { configSchema, type Config } from "./schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("config");

export async function loadConfig(path: string): Promise<Config> {
  // Expand leading ~
  const expandedPath = path.startsWith("~")
    ? resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".", path.slice(1))
    : path;

  log.info(`Loading config from ${expandedPath}`);

  const content = await readFile(expandedPath, "utf-8");
  const raw = parse(content);

  // Expand environment variables
  const expanded = expandEnvVars(raw) as any;

  // Backward-compat: map deprecated discord.requireMentionInGuild -> group.activation
  // If group.activation is explicitly set, it wins.
  if (expanded?.group?.activation === undefined && expanded?.discord?.requireMentionInGuild !== undefined) {
    expanded.group = expanded.group ?? {};
    expanded.group.activation = expanded.discord.requireMentionInGuild ? "mention" : "always";
  }

  // Validate with Zod
  const config = configSchema.parse(expanded);

  // Resolve workspace path relative to config file
  const configDir = dirname(resolve(expandedPath));
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
