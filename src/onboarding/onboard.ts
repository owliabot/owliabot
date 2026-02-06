import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";
import type { AppConfig, ProviderConfig, LLMProviderId, MemorySearchConfig, SystemCapabilityConfig, WalletConfig } from "./types.js";
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
    log.info("  1. anthropic     - Anthropic (API Key or setup-token)");
    log.info("  2. openai        - OpenAI (API Key)");
    log.info("  3. openai-codex  - OpenAI Codex (ChatGPT Plus/Pro OAuth)");

    const providerAns = await ask(
      rl,
      "\nSelect provider (1-3 or name) [anthropic]: "
    );

    // Map numeric input to provider ID
    const providerMap: Record<string, LLMProviderId> = {
      "1": "anthropic",
      "2": "openai",
      "3": "openai-codex",
      "anthropic": "anthropic",
      "openai": "openai",
      "openai-codex": "openai-codex",
    };

    let providerId: LLMProviderId =
      providerMap[providerAns] ?? providerMap[providerAns.toLowerCase()] ?? "anthropic";

    if (!providerAns) {
      providerId = "anthropic";
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
      log.info("  Anthropic Authentication");
      log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      log.info("");
      log.info("  Supports two authentication methods:");
      log.info("");
      log.info("  • Setup-token (Claude Pro/Max subscription)");
      log.info("    Run `claude setup-token` to generate one");
      log.info("    Format: sk-ant-oat01-...");
      log.info("");
      log.info("  • API Key (pay-as-you-go)");
      log.info("    Get from console.anthropic.com");
      log.info("    Format: sk-ant-api03-...");
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
          log.info("✓ Setup-token saved (Claude Pro/Max)");
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

    // Clawlet wallet integration
    log.info("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("  Clawlet Wallet Integration (optional)");
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("");
    log.info("  Clawlet provides secure wallet operations:");
    log.info("  • Query ETH/ERC-20 balances");
    log.info("  • Execute transfers (with policy-based confirmation)");
    log.info("");
    log.info("  Prerequisites:");
    log.info("  • Clawlet running locally (clawlet serve --http)");
    log.info("  • Auth token generated (clawlet auth grant --scope read)");
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const enableWalletAns = await ask(
      rl,
      "Enable Clawlet wallet integration? (y/n) [n]: "
    );
    const enableWallet = enableWalletAns.toLowerCase().startsWith("y");

    if (enableWallet) {
      const endpoint = await ask(
        rl,
        "Clawlet HTTP endpoint [http://127.0.0.1:8788]: "
      ) || "http://127.0.0.1:8788";

      const chainIdAns = await ask(
        rl,
        "Default chain ID (1=Mainnet, 8453=Base) [8453]: "
      );
      const defaultChainId = parseInt(chainIdAns, 10) || 8453;

      const clawletToken = await ask(
        rl,
        "Clawlet auth token (leave empty to set via CLAWLET_TOKEN env) [skip]: "
      );

      if (clawletToken) {
        secrets.clawlet = { token: clawletToken };
      }

      const walletConfig: WalletConfig = {
        clawlet: {
          endpoint,
          defaultChainId,
        },
      };
      config.wallet = walletConfig;

      log.info("✓ Clawlet wallet configured");
    }

    // Save app config (non-sensitive)
    await saveAppConfig(config, appConfigPath);

    // Save secrets (sensitive) - includes channel tokens, API keys, and wallet tokens
    const hasSecrets =
      secrets.discord?.token ||
      secrets.telegram?.token ||
      secrets.openai?.apiKey ||
      secrets.anthropic?.apiKey ||
      secrets.anthropic?.token ||
      secrets.clawlet?.token;

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

    // Wallet instructions
    if (config.wallet?.clawlet && !secrets.clawlet?.token) {
      log.info("• Set Clawlet token: export CLAWLET_TOKEN=<your-token>");
      log.info("  (Generate with: clawlet auth grant --scope read)");
    }

    log.info("• Start the bot: owliabot start");
  } finally {
    rl.close();
  }
}
