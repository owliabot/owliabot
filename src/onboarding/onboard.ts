import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";
import type { AppConfig, ProviderConfig, LLMProviderId, MemorySearchConfig, SystemCapabilityConfig } from "./types.js";
import { saveAppConfig, DEV_APP_CONFIG_PATH } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, type SecretsConfig } from "./secrets.js";
import { ensureWorkspaceInitialized } from "../workspace/init.js";
import { validateAnthropicSetupToken, isSetupToken } from "../auth/setup-token.js";

const log = createLogger("onboard");

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
}

/** Default models for each provider */
const DEFAULT_MODELS: Record<LLMProviderId, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  "openai-codex": "gpt-5.2",
  "claude-cli": "opus",
};

export interface OnboardOptions {
  appConfigPath?: string;
}

export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const appConfigPath = options.appConfigPath ?? DEV_APP_CONFIG_PATH;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    log.info("OwliaBot onboarding (dev)");

    const channelsAns = await ask(
      rl,
      "Enable channels (discord/telegram) [discord]: "
    );
    const channels = (channelsAns || "discord")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const workspace =
      (await ask(rl, "Workspace path [./workspace]: ")) || "./workspace";

    // Provider selection
    log.info("\nAvailable LLM providers:");
    log.info("  1. claude-cli    - Claude CLI (setup-token, Claude Pro/Max)");
    log.info("  2. anthropic     - Anthropic API (API Key)");
    log.info("  3. openai        - OpenAI (API Key)");
    log.info("  4. openai-codex  - OpenAI Codex (ChatGPT Plus/Pro OAuth)");

    const providerAns = await ask(
      rl,
      "\nSelect provider (1-4 or name) [claude-cli]: "
    );

    // Map numeric input to provider ID
    const providerMap: Record<string, LLMProviderId> = {
      "1": "claude-cli",
      "2": "anthropic",
      "3": "openai",
      "4": "openai-codex",
      "anthropic": "anthropic",
      "openai": "openai",
      "openai-codex": "openai-codex",
      "claude-cli": "claude-cli",
    };

    let providerId: LLMProviderId =
      providerMap[providerAns] ?? providerMap[providerAns.toLowerCase()] ?? "claude-cli";

    if (!providerAns) {
      providerId = "claude-cli";
    } else if (!providerMap[providerAns] && !providerMap[providerAns.toLowerCase()]) {
      log.warn(`Unknown provider: ${providerAns}, defaulting to anthropic`);
      providerId = "anthropic";
    }

    const defaultModel = DEFAULT_MODELS[providerId];
    const model =
      (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;

    const secrets: SecretsConfig = {};
    let apiKeyValue: string = "oauth";

    // Auth method depends on provider
    if (providerId === "openai") {
      // OpenAI only supports API key
      const apiKeyAns = await ask(
        rl,
        "OpenAI API key (leave empty to set via OPENAI_API_KEY env): "
      );
      if (apiKeyAns) {
        secrets.openai = { apiKey: apiKeyAns };
        apiKeyValue = "secrets"; // indicates to load from secrets
      } else {
        apiKeyValue = "env"; // indicates to load from env
      }
    } else if (providerId === "anthropic") {
      // Anthropic supports both setup-token and standard API key
      log.info("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      log.info("  Anthropic API");
      log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      log.info("");
      log.info("  Option 1: Setup-token (Claude Pro/Max) - run `claude setup-token`");
      log.info("  Option 2: Standard API key from console.anthropic.com");
      log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      const tokenAns = await ask(
        rl,
        "Paste setup-token or API key (leave empty to set via ANTHROPIC_API_KEY env): "
      );
      if (tokenAns) {
        if (isSetupToken(tokenAns)) {
          // Setup-token (sk-ant-oat01-...)
          const error = validateAnthropicSetupToken(tokenAns);
          if (error) {
            log.warn(`Setup-token validation warning: ${error}`);
          }
          secrets.anthropic = { token: tokenAns };
          log.info("✓ Setup-token saved");
        } else {
          // Standard API key
          secrets.anthropic = { apiKey: tokenAns };
          log.info("✓ API key saved");
        }
        apiKeyValue = "secrets";
      } else {
        apiKeyValue = "env";
      }
    } else if (providerId === "openai-codex") {
      // OpenAI Codex only supports OAuth
      const useOauthAns = await ask(
        rl,
        "Start OpenAI Codex OAuth now? (y/n) [n=skip for now]: "
      );
      const useOauth = useOauthAns.toLowerCase().startsWith("y");

      if (useOauth) {
        log.info("Starting OpenAI Codex OAuth flow...");
        await startOAuthFlow("openai-codex");
      } else {
        log.info(
          "Skipping OAuth. Run `owliabot auth setup openai-codex` later."
        );
      }
      apiKeyValue = "oauth";
    } else if (providerId === "claude-cli") {
      // Claude CLI uses setup-token for authentication
      log.info("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      log.info("  Claude CLI (setup-token)");
      log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      log.info("");
      log.info("  Requires Claude Pro/Max subscription.");
      log.info("  Run `claude setup-token` to generate a token.");
      log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      // Check if claude command is available
      const { execSync } = await import("node:child_process");
      try {
        execSync("which claude", { stdio: "ignore" });
        log.info("✓ claude command found\n");
      } catch {
        log.warn("⚠ claude command not found. Install: npm i -g @anthropic-ai/claude-code\n");
      }

      const tokenAns = await ask(
        rl,
        "Paste setup-token (or leave empty to run `claude setup-token` later): "
      );

      if (tokenAns) {
        if (isSetupToken(tokenAns)) {
          const error = validateAnthropicSetupToken(tokenAns);
          if (error) {
            log.warn(`Setup-token validation warning: ${error}`);
          }
          // Store in anthropic secrets (claude CLI reads from same location)
          secrets.anthropic = { token: tokenAns };
          log.info("✓ Setup-token saved");
        } else {
          log.warn("This doesn't look like a setup-token. Use option 1 for API keys.");
          secrets.anthropic = { token: tokenAns }; // Store anyway
        }
      } else {
        log.info("Run `claude setup-token` before starting the bot.");
      }

      apiKeyValue = ""; // CLI providers don't need apiKey in provider config
    }

    // Build provider config
    const providerConfig: ProviderConfig = {
      id: providerId,
      model,
      apiKey: apiKeyValue,
      priority: 1,
    } as ProviderConfig;

    // Default memory search config
    const memorySearchConfig: MemorySearchConfig = {
      enabled: true,
      provider: "sqlite",
      fallback: "naive",
      store: {
        path: "~/.owliabot/memory/{agentId}.sqlite",
      },
      extraPaths: [],
      sources: ["files"],
      indexing: {
        autoIndex: true,
        minIntervalMs: 5 * 60 * 1000, // 5 minutes
      },
    };

    // Default system capability config
    const systemConfig: SystemCapabilityConfig = {
      exec: {
        commandAllowList: [
          "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
          "date", "env", "which", "file", "stat", "du", "df", "curl",
        ],
        envAllowList: ["PATH", "HOME", "USER", "LANG", "LC_ALL"],
        timeoutMs: 60_000,
        maxOutputBytes: 256 * 1024,
      },
      web: {
        domainAllowList: [], // Empty = allow all public domains
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 15_000,
        maxResponseBytes: 512 * 1024,
        blockOnSecret: true,
      },
      webSearch: {
        defaultProvider: "duckduckgo",
        timeoutMs: 15_000,
        maxResults: 10,
      },
    };

    const config: AppConfig = {
      workspace,
      providers: [providerConfig],
      memorySearch: memorySearchConfig,
      system: systemConfig,
    };

    if (channels.includes("discord")) {
      const requireMentionAns =
        (await ask(
          rl,
          "In guild, require @mention unless channel allowlisted? (y/n) [y]: "
        )) || "y";
      const requireMentionInGuild = requireMentionAns
        .toLowerCase()
        .startsWith("y");

      const channelIds = await ask(
        rl,
        "Discord guild channelAllowList (comma-separated channel IDs) [1467915124764573736]: "
      );
      const channelAllowList = (channelIds || "1467915124764573736")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const discordToken = await ask(
        rl,
        "Discord bot token (leave empty to set later via `owliabot token set discord`) [skip]: "
      );
      if (discordToken) {
        secrets.discord = { token: discordToken };
      }

      // Write non-sensitive settings to app.yaml; token is stored in secrets.yaml
      config.discord = {
        requireMentionInGuild,
        channelAllowList,
      };
    }

    if (channels.includes("telegram")) {
      const telegramToken = await ask(
        rl,
        "Telegram bot token (leave empty to set later via `owliabot token set telegram`) [skip]: "
      );
      if (telegramToken) {
        secrets.telegram = { token: telegramToken };
      }

      // Always include telegram section so token can be set later via env/secrets
      config.telegram = {};
    }

    // Save app config (non-sensitive)
    await saveAppConfig(config, appConfigPath);

    // Save secrets (sensitive) - includes channel tokens and API keys
    const hasSecrets =
      secrets.discord?.token ||
      secrets.telegram?.token ||
      secrets.openai?.apiKey ||
      secrets.anthropic?.apiKey ||
      secrets.anthropic?.token;

    if (hasSecrets) {
      await saveSecrets(appConfigPath, secrets);
    }

    const workspaceInit = await ensureWorkspaceInitialized({
      workspacePath: workspace,
    });
    if (workspaceInit.wroteBootstrap) {
      log.info("Created BOOTSTRAP.md for first-run setup.");
    }

    log.info(`Saved app config to: ${appConfigPath}`);
    log.info("\nNext steps:");

    // Channel token instructions
    if (channels.includes("discord") && !secrets.discord?.token) {
      log.info("• Set Discord token: owliabot token set discord");
    }
    if (channels.includes("telegram") && !secrets.telegram?.token) {
      log.info("• Set Telegram token: owliabot token set telegram");
    }

    // Provider auth instructions
    if (apiKeyValue === "oauth") {
      log.info(`• If you skipped OAuth: owliabot auth setup ${providerId}`);
    } else if (apiKeyValue === "env") {
      const envVar =
        providerId === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      log.info(`• Set ${envVar} environment variable`);
    }

    log.info("• Start the bot: owliabot start");
  } finally {
    rl.close();
  }
}
