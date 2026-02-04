#!/usr/bin/env node
/**
 * OwliaBot entry point
 */

import { program } from "commander";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import { loadWorkspace } from "./workspace/loader.js";
import { startGateway } from "./gateway/server.js";
import { logger } from "./utils/logger.js";
import {
  startOAuthFlow,
  getOAuthStatus,
  clearOAuthCredentials,
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

      // Start gateway
      const stop = await startGateway({
        config,
        workspace,
        sessionsDir,
      });

      // Handle shutdown
      const shutdown = async () => {
        log.info("Shutting down...");
        await stop();
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
  .command("setup")
  .description("Setup OAuth authentication with Claude (Anthropic)")
  .action(async () => {
    try {
      log.info("Starting OAuth setup...");
      const credentials = await startOAuthFlow();
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
  .command("status")
  .description("Check authentication status")
  .action(async () => {
    const status = await getOAuthStatus();

    if (status.authenticated) {
      log.info("Authenticated with Anthropic OAuth");
      // Token is valid (auto-refresh already happened in getOAuthStatus if needed)
      if (status.expiresAt) {
        log.info(`Token expires at: ${new Date(status.expiresAt).toISOString()}`);
      }
      if (status.email) {
        log.info(`Account: ${status.email}`);
      }
    } else {
      log.info("Not authenticated.");
      log.info("Run 'owliabot auth setup' to authenticate, or set ANTHROPIC_API_KEY.");
    }
  });

auth
  .command("logout")
  .description("Clear stored authentication")
  .action(async () => {
    await clearOAuthCredentials();
    log.info("Logged out successfully");
  });

program.parse();
