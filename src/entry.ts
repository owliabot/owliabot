#!/usr/bin/env node
/**
 * OwliaBot entry point
 */

import { program } from "commander";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import { loadWorkspace } from "./workspace/loader.js";
import { startGateway } from "./gateway/server.js";
import { startGatewayHttp } from "./gateway-http/server.js";
import { logger } from "./utils/logger.js";
import {
  startOAuthFlow,
  getOAuthStatus,
  clearOAuthCredentials,
  getAllOAuthStatus,
  type SupportedOAuthProvider,
} from "./auth/oauth.js";
import { runOnboarding } from "./onboarding/onboard.js";
import { DEV_APP_CONFIG_PATH } from "./onboarding/storage.js";

const log = logger;

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (Number.isNaN(nodeMajor) || nodeMajor < 22) {
  log.error(
    `Node.js ${process.versions.node} is not supported. Please upgrade to >= 22.0.0.`
  );
  process.exit(1);
}

program
  .name("owliabot")
  .description("Crypto-native AI agent for Telegram and Discord")
  .version("0.1.0");

program
  .command("start")
  .description("Start the bot")
  .option(
    "-c, --config <path>",
    "Config file path (default: ~/.owlia_dev/app.yaml)",
    "~/.owlia_dev/app.yaml"
  )
  .action(async (options) => {
    try {
      log.info("Starting OwliaBot...");

      // Load config
      const config = await loadConfig(options.config);

      // Load workspace
      const workspace = await loadWorkspace(config.workspace);

      // Determine sessions directory
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
      const sessionsDir = join(homeDir, ".owliabot", "sessions");

      // Start gateway (message handler)
      const stopGateway = await startGateway({
        config,
        workspace,
        sessionsDir,
      });

      // Start HTTP gateway if configured
      let stopHttp: (() => Promise<void>) | undefined;
      if (config.gateway?.http) {
        const httpGateway = await startGatewayHttp({
          config: config.gateway.http,
          workspacePath: config.workspace,
          system: config.system,
        });
        stopHttp = httpGateway.stop;
        log.info(`Gateway HTTP server listening on ${httpGateway.baseUrl}`);
      }

      // Handle shutdown
      const shutdown = async () => {
        log.info("Shutting down...");
        if (stopHttp) await stopHttp();
        await stopGateway();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      log.info("OwliaBot is running. Press Ctrl+C to stop.");
    } catch (err) {
      log.error("Failed to start", err);
      process.exit(1);
    }
  });

program
  .command("onboard")
  .description("Interactive onboarding (dev): writes ~/.owlia_dev/app.yaml and guides OAuth")
  .option("--path <path>", "App config output path", DEV_APP_CONFIG_PATH)
  .action(async (options) => {
    try {
      await runOnboarding({ appConfigPath: options.path });
    } catch (err) {
      log.error("Onboarding failed", err);
      process.exit(1);
    }
  });

// Token command group (stores tokens to ~/.owlia_dev/secrets.yaml)
const token = program.command("token").description("Manage channel tokens (stored on disk)");

token
  .command("set")
  .description("Set a channel token from environment variables")
  .argument("<channel>", "discord|telegram")
  .action(async (channel: string) => {
    try {
      const { saveSecrets } = await import("./onboarding/secrets.js");
      const appConfigPath = DEV_APP_CONFIG_PATH;

      if (channel === "discord") {
        const value = process.env.DISCORD_BOT_TOKEN;
        if (!value) {
          throw new Error("DISCORD_BOT_TOKEN env not set");
        }
        await saveSecrets(appConfigPath, { discord: { token: value } });
        log.info("Discord token saved to ~/.owlia_dev/secrets.yaml");
        return;
      }

      if (channel === "telegram") {
        const value = process.env.TELEGRAM_BOT_TOKEN;
        if (!value) {
          throw new Error("TELEGRAM_BOT_TOKEN env not set");
        }
        await saveSecrets(appConfigPath, { telegram: { token: value } });
        log.info("Telegram token saved to ~/.owlia_dev/secrets.yaml");
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
  .description("Setup OAuth authentication (anthropic or openai-codex)")
  .action(async (provider?: string) => {
    try {
      const validProviders: SupportedOAuthProvider[] = ["anthropic", "openai-codex"];
      const selectedProvider: SupportedOAuthProvider =
        provider && validProviders.includes(provider as SupportedOAuthProvider)
          ? (provider as SupportedOAuthProvider)
          : "anthropic";

      if (provider && !validProviders.includes(provider as SupportedOAuthProvider)) {
        log.warn(`Unknown provider: ${provider}, defaulting to anthropic`);
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
  .description("Check authentication status (anthropic, openai-codex, or all)")
  .action(async (provider?: string) => {
    if (!provider || provider === "all") {
      // Show status for all providers
      const statuses = await getAllOAuthStatus();
      for (const [prov, status] of Object.entries(statuses)) {
        if (status.authenticated) {
          log.info(`${prov}: Authenticated`);
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
    } else {
      const validProviders: SupportedOAuthProvider[] = ["anthropic", "openai-codex"];
      const selectedProvider: SupportedOAuthProvider =
        validProviders.includes(provider as SupportedOAuthProvider)
          ? (provider as SupportedOAuthProvider)
          : "anthropic";

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
  .description("Clear stored authentication (anthropic, openai-codex, or all)")
  .action(async (provider?: string) => {
    const validProviders: SupportedOAuthProvider[] = ["anthropic", "openai-codex"];

    if (!provider || provider === "all") {
      for (const prov of validProviders) {
        await clearOAuthCredentials(prov);
      }
      log.info("Logged out from all providers");
    } else {
      const selectedProvider: SupportedOAuthProvider =
        validProviders.includes(provider as SupportedOAuthProvider)
          ? (provider as SupportedOAuthProvider)
          : "anthropic";
      await clearOAuthCredentials(selectedProvider);
      log.info(`Logged out from ${selectedProvider}`);
    }
  });

// Pair command - pair a device with the gateway
program
  .command("pair")
  .description("Pair a device with the gateway HTTP server")
  .option("--gateway-url <url>", "Gateway HTTP URL", "http://127.0.0.1:8787")
  .option("--gateway-token <token>", "Gateway token for auto-approve")
  .option("--device-id <id>", "Device ID (auto-generated if not provided)")
  .action(async (options) => {
    try {
      const { randomUUID } = await import("node:crypto");
      const deviceId = options.deviceId ?? randomUUID();
      const gatewayUrl = options.gatewayUrl.replace(/\/$/, "");

      log.info(`Pairing device: ${deviceId}`);
      log.info(`Gateway URL: ${gatewayUrl}`);

      // Step 1: Request pairing
      const requestRes = await fetch(`${gatewayUrl}/pairing/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
        },
      });

      if (!requestRes.ok) {
        const err = await requestRes.json().catch(() => ({}));
        throw new Error(`Pairing request failed: ${JSON.stringify(err)}`);
      }

      log.info("Pairing request submitted, status: pending");

      // Step 2: Auto-approve if gateway token provided
      if (options.gatewayToken) {
        log.info("Auto-approving with gateway token...");

        const approveRes = await fetch(`${gatewayUrl}/pairing/approve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Gateway-Token": options.gatewayToken,
          },
          body: JSON.stringify({ deviceId }),
        });

        if (!approveRes.ok) {
          const err = await approveRes.json().catch(() => ({}));
          throw new Error(`Pairing approval failed: ${JSON.stringify(err)}`);
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
          log.info("Use this token in requests:");
          log.info(`  X-Device-Id: ${result.data.deviceId}`);
          log.info(`  X-Device-Token: ${result.data.deviceToken}`);
        } else {
          throw new Error("Unexpected response format");
        }
      } else {
        log.info("");
        log.info("Device is pending approval.");
        log.info("To approve, run with --gateway-token or use the API:");
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

await program.parseAsync();
