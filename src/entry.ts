#!/usr/bin/env node
/**
 * OwliaBot entry point
 */

import { program } from "commander";
import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import updateNotifier from "update-notifier";
import { loadConfig } from "./config/loader.js";
import { ensureWorkspaceInitialized } from "./workspace/init.js";
import { loadWorkspace } from "./workspace/loader.js";
import { startGateway } from "./gateway/server.js";
import { logger } from "./utils/logger.js";
import {
  startOAuthFlow,
  getOAuthStatus,
  clearOAuthCredentials,
  getAllOAuthStatus,
  type SupportedOAuthProvider,
} from "./auth/oauth.js";
import { runGoOnboarding } from "./onboarding/go-runner.js";
import type { Config } from "./config/schema.js";
import { defaultConfigPath, ensureOwliabotHomeEnv, resolvePathLike } from "./utils/paths.js";
import { createDefaultDoctorIO, runDoctorCli } from "./doctor/cli.js";
import { listConfiguredModelCatalog } from "./models/catalog.js";
import { parseModelRef } from "./models/ref.js";
import { updateAppConfigYamlPrimaryModel, updateYamlFileAtomic } from "./models/config-file.js";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import { diagnoseDoctor } from "./doctor/index.js";

const log = logger;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
  name: string;
  version: string;
};

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (Number.isNaN(nodeMajor) || nodeMajor < 22) {
  log.error(
    `Node.js ${process.versions.node} is not supported. Please upgrade to >= 22.0.0.`
  );
  process.exit(1);
}

const isDocker = process.env.OWLIABOT_DOCKER === "1" || existsSync("/.dockerenv");
if (!isDocker) {
  updateNotifier({ pkg }).notify({
    message: "Update available {currentVersion} → {latestVersion}\nRun `npx owliabot@latest` to update",
  });
}

program
  .name("owliabot")
  .description("Crypto-native AI agent for Telegram and Discord")
  .version(pkg.version);

/**
 * Check if any OAuth providers are configured but lack credentials.
 * If so, print actionable instructions to the user.
 * Works in both Docker and local environments.
 */
async function checkOAuthProviders(config: Config): Promise<void> {
  const oauthProviders = config.providers.filter(
    (p) => p.apiKey === "oauth"
  );
  if (oauthProviders.length === 0) return;

  const missing: string[] = [];
  for (const provider of oauthProviders) {
    const oauthId = provider.id as SupportedOAuthProvider;
    // Only check providers that actually support OAuth
    if (oauthId !== "openai-codex") continue;
    const status = await getOAuthStatus(oauthId);
    if (!status.authenticated) {
      missing.push(provider.id);
    }
  }

  if (missing.length === 0) return;

  const isDocker = process.env.OWLIABOT_CONFIG_PATH != null ||
    (await import("node:fs")).existsSync("/.dockerenv");

  log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.warn("  OAuth credentials missing for: " + missing.join(", "));
  log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.warn("");
  if (isDocker) {
    log.warn("  Run the following to authenticate:");
    for (const id of missing) {
      log.warn(`    docker exec -it owliabot owliabot auth setup ${id}`);
    }
  } else {
    log.warn("  Run the following to authenticate:");
    for (const id of missing) {
      log.warn(`    owliabot auth setup ${id}`);
    }
  }
  log.warn("");
  log.warn("  The bot will start but these providers will not work until");
  log.warn("  OAuth is configured.");
  log.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

program
  .command("start")
  .description("Start the bot")
  .option(
    "-c, --config <path>",
    "Config file path (default: $OWLIABOT_HOME/app.yaml)",
    process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath()
  )
  .action(async (options) => {
    try {
      ensureOwliabotHomeEnv();
      log.info("Starting OwliaBot...");

      // Make the effective config path available to runtime commands (e.g. /model default).
      // This also keeps behavior consistent across "start -c <path>" and Docker env usage.
      process.env.OWLIABOT_CONFIG_PATH = options.config;

      // Load config
      const config = await loadConfig(options.config);

      // Check for missing OAuth credentials and print instructions
      await checkOAuthProviders(config);

      // Ensure workspace scaffold exists (idempotent; does not overwrite existing files).
      // This keeps system prompt sections (AGENTS/TOOLS/etc.) present even if users skip onboarding.
      await ensureWorkspaceInitialized({ workspacePath: config.workspace });

      // Load workspace
      const workspace = await loadWorkspace(config.workspace);

      // Determine sessions directory (fixed under OWLIABOT_HOME)
      const sessionsDir = join(ensureOwliabotHomeEnv(), "sessions");

      // Start gateway (message handler)
      const stopGateway = await startGateway({
        config,
        workspace,
        sessionsDir,
      });

      // Handle shutdown
      const shutdown = async () => {
        log.info("Shutting down...");
        try {
          await stopGateway();
        } catch (err) {
          log.error("Error stopping message gateway", err);
        }
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // ASCII art banner
      const version = pkg.version;
      const banner = [
        "",
        "   ___           _ _       ____        _   ",
        "  / _ \\__      _| (_) __ _| __ )  ___ | |_ ",
        " | | | \\ \\ /\\ / / | |/ _` |  _ \\ / _ \\| __|",
        " | |_| |\\ V  V /| | | (_| | |_) | (_) | |_ ",
        "  \\___/  \\_/\\_/ |_|_|\\__,_|____/ \\___/ \\__|",
        "",
        `  🦉  v${version} — Crypto-native AI Agent`,
        "",
        "  ✓ Bot is up and running",
        `  ⚠ PRERELEASE build — not for production use`,
        "",
        "  Press Ctrl+C to stop.",
        "",
      ];
      for (const line of banner) {
        log.info(line);
      }
    } catch (err) {
      log.error("Failed to start", err);
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Diagnose startup failures (config/tokens) and guide fixes")
  .option(
    "-c, --config <path>",
    "Config file path (default: $OWLIABOT_HOME/app.yaml)",
    process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath()
  )
  .option("--no-interactive", "Disable interactive prompts (exit non-zero on errors)")
  .option("--json", "Print diagnosis report as JSON and exit (non-interactive)")
  .action(async (options) => {
    try {
      ensureOwliabotHomeEnv();
      if (options.json) {
        const report = await diagnoseDoctor({ configPath: options.config });
        // Print raw JSON for CI/automation usage.
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.ok ? 0 : 1);
      }
      const interactive = Boolean(
        options.interactive && process.stdin.isTTY && process.stdout.isTTY,
      );
      const { io, close } = createDefaultDoctorIO({ interactive });
      try {
        const code = await runDoctorCli({ configPath: options.config, io });
        process.exit(code);
      } finally {
        close();
      }
    } catch (err) {
      log.error("Doctor failed", err);
      process.exit(1);
    }
  });

program
  .command("onboard")
  .description("Launch the Go onboarding wizard")
  .option("--docker", "Deprecated: Go onboarding is Docker-first by default")
  .option("--path <path>", "Deprecated: use --config-dir instead")
  .option("--config-dir <path>", "Config directory (default: ~/.owliabot)")
  .option("--output-dir <path>", "Output directory for docker-compose.yml")
  .option("--image <ref>", "OwliaBot Docker image reference")
  .option("--channel <channel>", "Onboard binary channel: stable|preview")
  .action(async (options) => {
    if (options.docker) {
      console.warn("Warning: --docker is deprecated. Go onboarding is Docker-first by default.");
    }
    try {
      await runGoOnboarding({
        configDir: options.configDir,
        outputDir: options.outputDir,
        image: options.image,
        channel: options.channel,
      });
    } catch (err) {
      log.error("Onboarding failed", err);
      process.exit(1);
    }
  });

// Token command group (stores tokens to secrets.yaml next to the app config, under $OWLIABOT_HOME by default)
const token = program.command("token").description("Manage channel tokens (stored on disk)");

token
  .command("set")
  .description("Set a channel token from environment variables")
  .argument("<channel>", "discord|telegram")
  .action(async (channel: string) => {
    try {
      const { saveSecrets } = await import("./onboarding/secrets.js");
      // Store alongside the default app.yaml unless user runs with a custom -c path.
      const appConfigPath = process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath();

      if (channel === "discord") {
        const value = process.env.DISCORD_BOT_TOKEN;
        if (!value) {
          throw new Error("DISCORD_BOT_TOKEN env not set");
        }
        await saveSecrets(appConfigPath, { discord: { token: value } });
        log.info("Discord token saved to secrets.yaml next to app config");
        return;
      }

      if (channel === "telegram") {
        const value = process.env.TELEGRAM_BOT_TOKEN;
        if (!value) {
          throw new Error("TELEGRAM_BOT_TOKEN env not set");
        }
        await saveSecrets(appConfigPath, { telegram: { token: value } });
        log.info("Telegram token saved to secrets.yaml next to app config");
        return;
      }

      throw new Error("Unknown channel. Use: discord|telegram");
    } catch (err) {
      log.error("Failed to set token", err);
      process.exit(1);
    }
  });

// Auth command group
const auth = program.command("auth").description("Manage authentication");

auth
  .command("setup [provider]")
  .description("Setup authentication (openai-codex uses OAuth; for anthropic, use 'claude setup-token')")
  .action(async (provider?: string) => {
    try {
      // Anthropic now uses setup-token instead of OAuth
      if (provider === "anthropic") {
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        log.info("  Anthropic authentication has changed!");
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        log.info("");
        log.info("  Run `claude setup-token` in your terminal to generate a token,");
        log.info("  then run `owliabot onboard` and paste the token when prompted.");
        log.info("");
        log.info("  The setup-token works with Claude Pro/Max subscriptions.");
        log.info("  You can also use a standard Anthropic API key instead.");
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        return;
      }

      const validProviders: SupportedOAuthProvider[] = ["openai-codex"];
      const selectedProvider: SupportedOAuthProvider =
        provider && validProviders.includes(provider as SupportedOAuthProvider)
          ? (provider as SupportedOAuthProvider)
          : "openai-codex";

      if (provider && !validProviders.includes(provider as SupportedOAuthProvider) && provider !== "anthropic") {
        log.warn(`Unknown provider: ${provider}, defaulting to openai-codex`);
      }

      log.info(`Starting ${selectedProvider} OAuth setup...`);
      const credentials = await startOAuthFlow(selectedProvider);
      log.info("Authentication successful!");
      log.info(`Token expires at: ${new Date(credentials.expires).toISOString()}`);
      if (credentials.email) {
        log.info(`Account: ${credentials.email}`);
      }
    } catch (err) {
      log.error("Authentication failed", err);
      process.exit(1);
    }
  });

auth
  .command("status [provider]")
  .description("Check authentication status (openai-codex or all; anthropic uses setup-token)")
  .action(async (provider?: string) => {
    if (!provider || provider === "all") {
      // Show status for OAuth providers (only openai-codex now)
      const statuses = await getAllOAuthStatus();
      for (const [prov, status] of Object.entries(statuses)) {
        if (status.authenticated) {
          log.info(`${prov}: Authenticated (OAuth)`);
          if (status.expiresAt) {
            log.info(`  Expires: ${new Date(status.expiresAt).toISOString()}`);
          }
          if (status.email) {
            log.info(`  Account: ${status.email}`);
          }
        } else {
          log.info(`${prov}: Not authenticated`);
        }
      }
      // Note about Anthropic
      log.info(`anthropic: Uses setup-token (stored in secrets.yaml)`);
    } else if (provider === "anthropic") {
      log.info("Anthropic uses setup-token authentication (stored in secrets.yaml).");
      log.info("Run `claude setup-token` to generate a token, then run `owliabot onboard`.");
    } else {
      const validProviders: SupportedOAuthProvider[] = ["openai-codex"];
      const selectedProvider: SupportedOAuthProvider =
        validProviders.includes(provider as SupportedOAuthProvider)
          ? (provider as SupportedOAuthProvider)
          : "openai-codex";

      const status = await getOAuthStatus(selectedProvider);

      if (status.authenticated) {
        log.info(`Authenticated with ${selectedProvider} OAuth`);
        if (status.expiresAt) {
          log.info(`Token expires at: ${new Date(status.expiresAt).toISOString()}`);
        }
        if (status.email) {
          log.info(`Account: ${status.email}`);
        }
      } else {
        log.info(`Not authenticated with ${selectedProvider}.`);
        log.info(`Run 'owliabot auth setup ${selectedProvider}' to authenticate.`);
      }
    }
  });

auth
  .command("logout [provider]")
  .description("Clear stored authentication (openai-codex or all; anthropic uses secrets.yaml)")
  .action(async (provider?: string) => {
    const validProviders: SupportedOAuthProvider[] = ["openai-codex"];

    if (!provider || provider === "all") {
      for (const prov of validProviders) {
        await clearOAuthCredentials(prov);
      }
      log.info("Logged out from OAuth providers (openai-codex)");
      log.info("Note: Anthropic tokens are stored in secrets.yaml - edit that file to remove.");
    } else if (provider === "anthropic") {
      log.info("Anthropic tokens are stored in secrets.yaml.");
      log.info("To remove, edit secrets.yaml next to your app config and delete the anthropic section.");
    } else {
      const selectedProvider: SupportedOAuthProvider =
        validProviders.includes(provider as SupportedOAuthProvider)
          ? (provider as SupportedOAuthProvider)
          : "openai-codex";
      await clearOAuthCredentials(selectedProvider);
      log.info(`Logged out from ${selectedProvider}`);
    }
  });

// Pair command - pair a device with the gateway
program
  .command("pair")
  .description("Pair a device with the gateway HTTP server")
  .option("--gateway-url <url>", "Gateway HTTP URL (default: http://127.0.0.1:8787)", "http://127.0.0.1:8787")
  .option("--gateway-token <token>", "Gateway token for auto-approve (or set OWLIABOT_GATEWAY_TOKEN)")
  .option("--device-id <id>", "Device ID (auto-generated UUID if not provided)")
  .option("--timeout <ms>", "Request timeout in milliseconds", "30000")
  .action(async (options) => {
    try {
      const { randomUUID } = await import("node:crypto");
      
      // Get gateway token from option or env var (env var preferred for security)
      const gatewayToken = options.gatewayToken ?? process.env.OWLIABOT_GATEWAY_TOKEN;
      
      // Validate device ID if provided
      const deviceId = options.deviceId ?? randomUUID();
      if (options.deviceId && !/^[a-zA-Z0-9_-]+$/.test(options.deviceId)) {
        throw new Error("Invalid device ID: must contain only alphanumeric characters, dashes, and underscores");
      }
      
      const gatewayUrl = options.gatewayUrl.replace(/\/$/, "");
      const timeoutMs = parseInt(options.timeout, 10);
      
      if (isNaN(timeoutMs) || timeoutMs < 1000) {
        throw new Error("Invalid timeout: must be at least 1000ms");
      }

      log.info(`Pairing device: ${deviceId}`);
      log.info(`Gateway URL: ${gatewayUrl}`);

      // Helper for fetch with timeout
      const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
      };

      // Step 1: Request pairing
      let requestRes: Response;
      try {
        requestRes = await fetchWithTimeout(`${gatewayUrl}/pairing/request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Device-Id": deviceId,
          },
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(`Pairing request timed out after ${timeoutMs}ms`);
        }
        throw new Error(`Pairing request failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!requestRes.ok) {
        let errDetails = `HTTP ${requestRes.status}`;
        try {
          const errBody = await requestRes.json();
          errDetails = JSON.stringify(errBody);
        } catch {
          // Keep HTTP status as error detail
        }
        throw new Error(`Pairing request failed: ${errDetails}`);
      }

      log.info("Pairing request submitted, status: pending");

      // Step 2: Auto-approve if gateway token provided
      if (gatewayToken) {
        log.info("Auto-approving with gateway token...");

        let approveRes: Response;
        try {
          approveRes = await fetchWithTimeout(`${gatewayUrl}/pairing/approve`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Gateway-Token": gatewayToken,
            },
            body: JSON.stringify({ deviceId }),
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error(`Pairing approval timed out after ${timeoutMs}ms`);
          }
          throw new Error(`Pairing approval failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!approveRes.ok) {
          let errDetails = `HTTP ${approveRes.status}`;
          try {
            const errBody = await approveRes.json();
            errDetails = JSON.stringify(errBody);
          } catch {
            // Keep HTTP status as error detail
          }
          throw new Error(`Pairing approval failed: ${errDetails}`);
        }

        const result = (await approveRes.json()) as {
          ok: boolean;
          data?: { deviceId: string; deviceToken: string };
        };

        if (result.ok && result.data?.deviceToken) {
          log.info("Device paired successfully!");
          log.info(`Device ID: ${result.data.deviceId}`);
          log.info(`Device Token: ${result.data.deviceToken}`);
          log.info("");
          log.warn("⚠️  Store the device token securely! It will not be shown again.");
          log.info("");
          log.info("Use these headers in requests:");
          log.info(`  X-Device-Id: ${result.data.deviceId}`);
          log.info(`  X-Device-Token: ${result.data.deviceToken}`);
        } else {
          throw new Error("Unexpected response format");
        }
      } else {
        log.info("");
        log.info("Device is pending approval.");
        log.info("To approve, set OWLIABOT_GATEWAY_TOKEN env var and re-run, or use the API:");
        log.info(`  curl -X POST ${gatewayUrl}/pairing/approve \\`);
        log.info(`    -H "X-Gateway-Token: <token>" \\`);
        log.info(`    -H "Content-Type: application/json" \\`);
        log.info(`    -d '{"deviceId": "${deviceId}"}'`);
      }
    } catch (err) {
      log.error("Pairing failed", err);
      process.exit(1);
    }
  });

// Models command group
const models = program.command("models").description("List and configure available LLM models");

models
  .command("list [filter]")
  .description("List available models for configured providers (optional substring filter)")
  .option(
    "-c, --config <path>",
    "Config file path (default: $OWLIABOT_HOME/app.yaml)",
    process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath(),
  )
  .action(async (filter: string | undefined, options) => {
    try {
      const config = await loadConfig(options.config);
      const entries = listConfiguredModelCatalog({ providers: config.providers, filter });
      if (entries.length === 0) {
        log.info("No models found.");
        return;
      }
      for (const e of entries) {
        const label = e.name && e.name !== e.model ? `  # ${e.name}` : "";
        console.log(`${e.key}${label}`);
      }
    } catch (err) {
      log.error("Failed to list models", err);
      process.exit(1);
    }
  });

models
  .command("get")
  .description("Show current default primary model from app.yaml")
  .option(
    "-c, --config <path>",
    "Config file path (default: $OWLIABOT_HOME/app.yaml)",
    process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath(),
  )
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      const sorted = [...config.providers].sort((a, b) => a.priority - b.priority);
      const primary = sorted[0];
      if (!primary) {
        throw new Error("No providers configured");
      }
      console.log(`${primary.id}/${primary.model}`);
    } catch (err) {
      log.error("Failed to get default model", err);
      process.exit(1);
    }
  });

models
  .command("set <modelRefOrId>")
  .description("Set default primary model (writes app.yaml providers priorities and model)")
  .option(
    "-c, --config <path>",
    "Config file path (default: $OWLIABOT_HOME/app.yaml)",
    process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath(),
  )
  .action(async (modelRefOrId: string, options) => {
    try {
      const configPath = resolvePathLike(options.config);

      const token = String(modelRefOrId ?? "").trim();
      if (!token) {
        throw new Error("Model ref is required");
      }

      await updateYamlFileAtomic(configPath, (rawYaml) => {
        let override = parseModelRef(token);
        if (!override) {
          // Treat as "model id for current default provider"
          const doc = parseYaml(rawYaml) as any;
          const providers = Array.isArray(doc?.providers) ? doc.providers : null;
          if (!providers || providers.length === 0) {
            throw new Error("No providers configured in app.yaml");
          }
          const sorted = [...providers].sort((a, b) => Number(a?.priority ?? 0) - Number(b?.priority ?? 0));
          const primaryId = String(sorted[0]?.id ?? "").trim();
          if (!primaryId) {
            throw new Error("Invalid providers[]: missing id on primary provider");
          }
          override = { provider: primaryId, model: token };
        }

        return updateAppConfigYamlPrimaryModel(rawYaml, override);
      });

      // Read back the updated app.yaml to report the current primary model.
      // (TypeScript does not track assignments inside update callbacks reliably.)
      const updatedYaml = await readFile(configPath, "utf-8");
      const updatedDoc = parseYaml(updatedYaml) as any;
      const updatedProviders = Array.isArray(updatedDoc?.providers) ? updatedDoc.providers : null;
      if (!updatedProviders || updatedProviders.length === 0) {
        throw new Error("Default model updated but providers[] is missing in app.yaml");
      }
      const sorted = [...updatedProviders].sort(
        (a, b) => Number(a?.priority ?? 0) - Number(b?.priority ?? 0)
      );
      const primaryId = String(sorted[0]?.id ?? "").trim();
      const primaryModel = String(sorted[0]?.model ?? "").trim();
      if (!primaryId || !primaryModel) {
        throw new Error("Default model updated but primary provider is invalid in app.yaml");
      }

      log.info(`Default model updated: ${primaryId}/${primaryModel}`);
    } catch (err) {
      log.error("Failed to set default model", err);
      process.exit(1);
    }
  });

// API Key command group
const apiKey = program.command("api-key").description("Manage API keys for programmatic access");

apiKey
  .command("create")
  .description("Create a new API key")
  .requiredOption("--name <name>", "Human-readable name for the key")
  .option("--scope <scope>", "Comma-separated scopes (e.g. tools:read,system,mcp)", "tools:read")
  .option("--expires-in <seconds>", "Key expiry in seconds from now")
  .option("--gateway-url <url>", "Gateway HTTP URL", process.env.OWLIABOT_GATEWAY_URL ?? "http://127.0.0.1:8787")
  .option("--gateway-token <token>", "Gateway token", process.env.OWLIABOT_GATEWAY_TOKEN)
  .action(async (options) => {
    try {
      if (!options.gatewayToken) {
        throw new Error("Gateway token required (--gateway-token or OWLIABOT_GATEWAY_TOKEN)");
      }

      // Parse scope string into DeviceScope
      const scopeParts = (options.scope as string).split(",").map((s: string) => s.trim());
      const scope: Record<string, any> = { tools: "read", system: false, mcp: false };
      for (const part of scopeParts) {
        if (part.startsWith("tools:")) {
          scope.tools = part.slice("tools:".length);
        } else if (part === "system") {
          scope.system = true;
        } else if (part === "mcp") {
          scope.mcp = true;
        }
      }

      const body: Record<string, any> = { name: options.name, scope };
      if (options.expiresIn) {
        body.expiresAt = Date.now() + parseInt(options.expiresIn, 10) * 1000;
      }

      const res = await fetch(`${options.gatewayUrl}/admin/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Token": options.gatewayToken,
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as any;
      if (!json.ok) {
        throw new Error(json.error?.message ?? "Failed to create API key");
      }

      log.info("API key created successfully!");
      log.info(`  ID:    ${json.data.id}`);
      log.info(`  Key:   ${json.data.key}`);
      log.info(`  Scope: ${JSON.stringify(json.data.scope)}`);
      if (json.data.expiresAt) {
        log.info(`  Expires: ${new Date(json.data.expiresAt).toISOString()}`);
      }
      log.warn("⚠️  Store the key securely! It will not be shown again.");
    } catch (err) {
      log.error("Failed to create API key", err);
      process.exit(1);
    }
  });

apiKey
  .command("list")
  .description("List all API keys")
  .option("--gateway-url <url>", "Gateway HTTP URL", process.env.OWLIABOT_GATEWAY_URL ?? "http://127.0.0.1:8787")
  .option("--gateway-token <token>", "Gateway token", process.env.OWLIABOT_GATEWAY_TOKEN)
  .action(async (options) => {
    try {
      if (!options.gatewayToken) {
        throw new Error("Gateway token required (--gateway-token or OWLIABOT_GATEWAY_TOKEN)");
      }

      const res = await fetch(`${options.gatewayUrl}/admin/api-keys`, {
        headers: { "X-Gateway-Token": options.gatewayToken },
      });

      const json = (await res.json()) as any;
      if (!json.ok) {
        throw new Error(json.error?.message ?? "Failed to list API keys");
      }

      if (json.data.keys.length === 0) {
        log.info("No API keys found.");
        return;
      }

      for (const key of json.data.keys) {
        const status = key.revokedAt ? "REVOKED" : key.expiresAt && key.expiresAt <= Date.now() ? "EXPIRED" : "ACTIVE";
        log.info(`${key.id}  ${key.name}  [${status}]  scope=${JSON.stringify(key.scope)}  created=${new Date(key.createdAt).toISOString()}`);
      }
    } catch (err) {
      log.error("Failed to list API keys", err);
      process.exit(1);
    }
  });

apiKey
  .command("revoke")
  .description("Revoke an API key")
  .argument("<id>", "API key ID (e.g. ak_xxxx)")
  .option("--gateway-url <url>", "Gateway HTTP URL", process.env.OWLIABOT_GATEWAY_URL ?? "http://127.0.0.1:8787")
  .option("--gateway-token <token>", "Gateway token", process.env.OWLIABOT_GATEWAY_TOKEN)
  .action(async (id: string, options) => {
    try {
      if (!options.gatewayToken) {
        throw new Error("Gateway token required (--gateway-token or OWLIABOT_GATEWAY_TOKEN)");
      }

      const res = await fetch(`${options.gatewayUrl}/admin/api-keys/${id}`, {
        method: "DELETE",
        headers: { "X-Gateway-Token": options.gatewayToken },
      });

      const json = (await res.json()) as any;
      if (!json.ok) {
        throw new Error(json.error?.message ?? "Failed to revoke API key");
      }

      log.info(`API key ${id} revoked successfully.`);
    } catch (err) {
      log.error("Failed to revoke API key", err);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Wallet command group — runtime wallet connect/disconnect (memory-only)
// ─────────────────────────────────────────────────────────────────────────────
const wallet = program.command("wallet").description("Manage wallet integration (Clawlet)");

/**
 * Read gateway HTTP url and token from app.yaml config.
 * Throws if gateway.http is not configured.
 */
async function loadGatewayInfo(configOverride?: string): Promise<{ gatewayUrl: string; gatewayToken: string | undefined }> {
  const configPath = configOverride ?? process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath();
  const config = await loadConfig(configPath);
  const http = config.gateway?.http;
  if (!http) {
    throw new Error("gateway.http is not configured in config; cannot determine gateway URL");
  }
  if (http.enabled === false) {
    throw new Error("gateway.http.enabled is false; cannot connect to admin endpoint");
  }
  let host = http.host ?? "127.0.0.1";
  // Normalize wildcard bind addresses to localhost for client requests
  if (host === "0.0.0.0") {
    host = "127.0.0.1";
  } else if (host === "::") {
    host = "::1";
  }
  const port = http.port ?? 8787;
  // Bracket IPv6 literals in URLs (e.g. ::1 → [::1])
  const urlHost = host.includes(":") ? `[${host}]` : host;
  return {
    gatewayUrl: `http://${urlHost}:${port}`,
    gatewayToken: http.token,
  };
}

wallet
  .command("connect")
  .description("Connect wallet to the running gateway (stored in memory only)")
  .option("-c, --config <path>", "Config file path (overrides OWLIABOT_CONFIG_PATH)")
  .option("--gateway-token <token>", "Gateway auth token (overrides config)")
  .option("--base-url <url>", "Clawlet daemon base URL (auto-detected in Docker)")
  .option("--token <token>", "Clawlet auth token (or set CLAWLET_TOKEN env)")
  .option("--chain-id <id>", "Default chain ID", "8453")
  .option("--scope <scope>", "Token scope: read, trade, or read,trade", "trade")
  .action(async (options) => {
    try {
      const info = await loadGatewayInfo(options.config);
      const gatewayUrl = info.gatewayUrl;
      const gatewayToken = options.gatewayToken ?? info.gatewayToken;

      const { resolveClawletBaseUrl } = await import("./wallet/clawlet-client.js");
      let baseUrl: string = options.baseUrl ?? resolveClawletBaseUrl();
      let token: string | undefined = options.token ?? process.env.CLAWLET_TOKEN;
      let chainId = parseInt(options.chainId, 10);

      // If token not provided, prompt interactively
      if (!token) {
        const { createInterface } = await import("node:readline");
        const { detectClawlet, isValidClawletToken } = await import("./wallet/detect.js");

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> =>
          new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

        try {
          log.info("Checking for Clawlet daemon...");
          const detection = await detectClawlet();
          if (detection.detected) {
            const v = detection.version ? ` (v${detection.version})` : "";
            log.info(`Clawlet daemon detected${v}`);
          } else {
            log.warn(detection.error?.message ?? "Clawlet daemon not detected");
          }

          const baseUrlAns = await ask(`Clawlet base URL [${baseUrl}]: `);
          if (baseUrlAns) baseUrl = baseUrlAns;

          const tokenAns = await new Promise<string>((resolve) => {
            process.stdout.write("Paste Clawlet token: ");
            const stdin = process.stdin;
            const wasRaw = stdin.isRaw;
            if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
            let buf = "";
            const onData = (ch: Buffer) => {
              const c = ch.toString();
              if (c === "\n" || c === "\r") {
                stdin.removeListener("data", onData);
                if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw ?? false);
                process.stdout.write("\n");
                resolve(buf.trim());
              } else if (c === "\x7f" || c === "\b") {
                buf = buf.slice(0, -1);
              } else if (c === "\x03") {
                // Ctrl+C
                stdin.removeListener("data", onData);
                if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw ?? false);
                resolve("");
              } else {
                buf += c;
              }
            };
            stdin.on("data", onData);
          });
          if (!isValidClawletToken(tokenAns)) {
            throw new Error("Invalid token format (should start with 'clwt_')");
          }
          token = tokenAns;

          const chainIdAns = await ask(`Default chain ID [${chainId}]: `);
          if (chainIdAns) chainId = parseInt(chainIdAns, 10);
        } finally {
          rl.close();
        }
      }

      if (!token) {
        throw new Error("Clawlet token required (--token, CLAWLET_TOKEN, or interactive prompt)");
      }
      if (isNaN(chainId) || chainId <= 0) {
        throw new Error("Invalid chain ID");
      }

      log.info(`Connecting wallet to gateway at ${gatewayUrl}...`);

      const res = await fetch(`${gatewayUrl}/admin/wallet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(gatewayToken ? { "X-Gateway-Token": gatewayToken } : {}),
        },
        body: JSON.stringify({
          baseUrl,
          token,
          defaultChainId: chainId,
          scope: options.scope,
        }),
      });

      const json = (await res.json()) as any;
      if (!json.ok) {
        throw new Error(json.error?.message ?? "Failed to connect wallet");
      }

      log.info("Wallet connected successfully!");
      log.info(`  Address: ${json.data.wallet?.address ?? "unknown"}`);
      log.info(`  Balance: ${json.data.wallet?.ethBalance ?? "?"} ETH`);
      log.info(`  Scope:   ${options.scope}`);
      log.info(`  Tools:   ${json.data.tools.join(", ")}`);
      log.info("");
      log.warn("Note: Wallet config is stored in gateway memory only.");
      log.warn("It will be lost when the gateway restarts.");
    } catch (err) {
      log.error("Failed to connect wallet", err);
      process.exit(1);
    }
  });

wallet
  .command("disconnect")
  .description("Disconnect wallet from the running gateway")
  .option("-c, --config <path>", "Config file path (overrides OWLIABOT_CONFIG_PATH)")
  .option("--gateway-token <token>", "Gateway auth token (overrides config)")
  .action(async (options) => {
    try {
      const info = await loadGatewayInfo(options.config);
      const gatewayUrl = info.gatewayUrl;
      const gatewayToken = options.gatewayToken ?? info.gatewayToken;

      const res = await fetch(`${gatewayUrl}/admin/wallet`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(gatewayToken ? { "X-Gateway-Token": gatewayToken } : {}),
        },
      });

      const json = (await res.json()) as any;
      if (!json.ok) {
        throw new Error(json.error?.message ?? "Failed to disconnect wallet");
      }

      log.info("Wallet disconnected.");
      if (json.data.removed.length > 0) {
        log.info(`  Removed tools: ${json.data.removed.join(", ")}`);
      } else {
        log.info("  (No wallet tools were registered)");
      }
    } catch (err) {
      log.error("Failed to disconnect wallet", err);
      process.exit(1);
    }
  });

// Logs command — view real-time logs (auto-detects npm/Docker environment)
program
  .command("logs")
  .description("View real-time logs (auto-detects npm/Docker environment)")
  .option("-f, --follow", "Follow log output", true)
  .option("--no-follow", "Do not follow (print and exit)")
  .option("-n, --lines <number>", "Number of initial lines to show", "100")
  .option("--level <level>", "Filter by log level (debug|info|warn|error)")
  .option("--grep <pattern>", "Filter by text pattern")
  .option("--container <name>", "Docker container name", "owliabot")
  .option("--file <path>", "Log file path (overrides auto-detect)")
  .action(async (options) => {
    try {
      const { detectLogSource, streamLogs } = await import("./logs/index.js");

      const { source, hint } = await detectLogSource({
        file: options.file,
        container: options.container,
      });

      if (!source) {
        if (hint) log.info(hint);
        process.exit(0);
      }

      const stream = streamLogs({
        follow: options.follow,
        lines: parseInt(options.lines, 10) || 100,
        level: options.level,
        grep: options.grep,
        source,
      });

      for await (const line of stream) {
        console.log(line);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
        // Stream closed (e.g. container stopped) — exit cleanly
        process.exit(0);
      }
      log.error("Failed to read logs", err);
      process.exit(1);
    }
  });

// Security command group
const security = program.command("security").description("Manage WriteGate and security configuration");

security
  .command("show")
  .description("Display current security configuration")
  .action(async () => {
    try {
      const { securityShow } = await import("./security/cli.js");
      await securityShow();
    } catch (err) {
      log.error("Failed to show security config", err);
      process.exit(1);
    }
  });

security
  .command("setup")
  .description("Interactive security configuration")
  .action(async () => {
    try {
      const { securitySetup } = await import("./security/cli.js");
      await securitySetup();
    } catch (err) {
      log.error("Security setup failed", err);
      process.exit(1);
    }
  });

security
  .command("add-user")
  .description("Add a user to the writeToolAllowList")
  .argument("<userId>", "Discord or Telegram user ID")
  .action(async (userId: string) => {
    try {
      const { securityAddUser } = await import("./security/cli.js");
      await securityAddUser(userId);
    } catch (err) {
      log.error("Failed to add user", err);
      process.exit(1);
    }
  });

security
  .command("remove-user")
  .description("Remove a user from the writeToolAllowList")
  .argument("<userId>", "Discord or Telegram user ID")
  .action(async (userId: string) => {
    try {
      const { securityRemoveUser } = await import("./security/cli.js");
      await securityRemoveUser(userId);
    } catch (err) {
      log.error("Failed to remove user", err);
      process.exit(1);
    }
  });

await program.parseAsync();
