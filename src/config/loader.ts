/**
 * Config loader with environment variable expansion
 */

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { resolve, dirname, join } from "node:path";
import { configSchema, type Config } from "./schema.js";
import { createLogger } from "../utils/logger.js";
import { ZodError } from "zod";

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

  let content: string;
  try {
    content = await readFile(expandedPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Config file not found: ${expandedPath}`);
    }
    throw err;
  }
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

  // Merge Clawlet wallet token from secrets/env
  // Priority: config value > secrets.clawlet.token > env var
  if (raw?.wallet?.clawlet) {
    if (!raw.wallet.clawlet.token) {
      raw.wallet.clawlet.token =
        secrets?.clawlet?.token ??
        process.env.CLAWLET_TOKEN ??
        undefined;
    }
  }

  // Merge provider API keys from secrets/env
  // Respect user's explicit choice: "secrets" = use secrets.yaml, "env" = use env vars only
  if (Array.isArray(raw?.providers)) {
    for (const provider of raw.providers) {
      if (provider.apiKey === "secrets") {
        // Prefer secrets, fallback to env
        if (provider.id === "openai") {
          provider.apiKey =
            secrets?.openai?.apiKey ?? process.env.OPENAI_API_KEY ?? undefined;
        } else if (provider.id === "anthropic") {
          // For Anthropic, check setup-token first, then standard API key, then env
          // setup-token (sk-ant-oat01-) takes precedence over standard API key
          provider.apiKey =
            secrets?.anthropic?.token ??
            secrets?.anthropic?.apiKey ??
            process.env.ANTHROPIC_API_KEY ??
            undefined;
        } else if (provider.id === "openai-compatible") {
          // OpenAI-compatible can also use secrets.yaml
          provider.apiKey =
            secrets?.["openai-compatible"]?.apiKey ?? undefined;
        }
      } else if (provider.apiKey === "env") {
        // Only use env vars (user explicitly chose env-based auth)
        if (provider.id === "openai") {
          provider.apiKey = process.env.OPENAI_API_KEY ?? undefined;
        } else if (provider.id === "anthropic") {
          provider.apiKey = process.env.ANTHROPIC_API_KEY ?? undefined;
        }
      }
    }
  }

  // Merge gateway token from secrets/env
  if (raw?.gateway?.http?.token === "secrets") {
    raw.gateway.http.token =
      secrets?.gateway?.token ?? process.env.OWLIABOT_GATEWAY_TOKEN ?? undefined;
  }

  // Expand environment variables
  const expanded = expandEnvVars(raw) as any;

  // Backward-compat: map deprecated discord.requireMentionInGuild -> group.activation
  // If group.activation is explicitly set, it wins.
  if (expanded?.group?.activation === undefined && expanded?.discord?.requireMentionInGuild !== undefined) {
    expanded.group = expanded.group ?? {};
    expanded.group.activation = expanded.discord.requireMentionInGuild ? "mention" : "always";
  }

  // Validate with Zod
  let config: Config;
  try {
    config = configSchema.parse(expanded);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(formatZodError(err));
    }
    throw err;
  }

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

function formatZodError(error: ZodError): string {
  const lines = error.errors.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `- ${path}: ${issue.message}`;
  });
  return `Config validation failed:\n${lines.join("\n")}`;
}
