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
        // Wrap each stop in try/catch to ensure all cleanup runs
        if (stopHttp) {
          try {
            await stopHttp();
          } catch (err) {
            log.error("Error stopping HTTP gateway", err);
          }
        }
        try {
          await stopGateway();
        } catch (err) {
          log.error("Error stopping message gateway", err);
        }
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
      log.info("To remove, edit ~/.owlia_dev/secrets.yaml and delete the anthropic section.");
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

await program.parseAsync();
