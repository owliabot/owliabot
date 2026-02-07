import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "../utils/logger.js";
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig } from "./types.js";
import { saveAppConfig, DEFAULT_APP_CONFIG_PATH, IS_DEV_MODE } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, loadSecrets, type SecretsConfig } from "./secrets.js";
import { ensureWorkspaceInitialized } from "../workspace/init.js";
import { runClawletOnboarding } from "./clawlet-onboard.js";
import { validateAnthropicSetupToken, isSetupToken } from "../auth/setup-token.js";
import {
  COLORS,
  info,
  success,
  warn,
  header,
  ask,
  askYN,
  selectOption,
  printBanner,
  DEFAULT_MODELS,
  type ExistingConfig,
} from "./shared.js";

const log = createLogger("onboard");

async function detectExistingConfigFromSecrets(appConfigPath: string): Promise<ExistingConfig | null> {
  try {
    const existing = await loadSecrets(appConfigPath);
    if (!existing) return null;
    
    const result: ExistingConfig = {};
    let hasAny = false;
    
    if (existing.anthropic?.apiKey) {
      result.anthropicKey = existing.anthropic.apiKey;
      hasAny = true;
    }
    if (existing.anthropic?.token) {
      result.anthropicToken = existing.anthropic.token;
      hasAny = true;
    }
    if (existing.openai?.apiKey) {
      result.openaiKey = existing.openai.apiKey;
      hasAny = true;
    }
    if (existing.discord?.token) {
      result.discordToken = existing.discord.token;
      hasAny = true;
    }
    if (existing.telegram?.token) {
      result.telegramToken = existing.telegram.token;
      hasAny = true;
    }
    
    return hasAny ? result : null;
  } catch {
    return null;
  }
}

export interface OnboardOptions {
  appConfigPath?: string;
}

export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const appConfigPath = options.appConfigPath ?? DEFAULT_APP_CONFIG_PATH;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    printBanner(IS_DEV_MODE ? "(dev mode)" : "");
    if (IS_DEV_MODE) {
      info("Dev mode enabled (OWLIABOT_DEV=1). Config will be saved to ~/.owlia_dev/");
    }

    // Check for existing config
    const existing = await detectExistingConfigFromSecrets(appConfigPath);
    let reuseExisting = false;
    const secrets: SecretsConfig = {};
    
    if (existing) {
      header("Existing configuration found");
      info(`Found existing config at: ${dirname(appConfigPath)}`);
      
      if (existing.anthropicKey) info(`Found Anthropic API key: ${existing.anthropicKey.slice(0, 15)}...`);
      if (existing.anthropicToken) info("Found Anthropic setup-token");
      if (existing.openaiKey) info(`Found OpenAI API key: ${existing.openaiKey.slice(0, 10)}...`);
      if (existing.discordToken) info(`Found Discord token: ${existing.discordToken.slice(0, 20)}...`);
      if (existing.telegramToken) info(`Found Telegram token: ${existing.telegramToken.slice(0, 10)}...`);
      
      reuseExisting = await askYN(rl, "Do you want to reuse existing configuration?", true);
      if (reuseExisting) {
        success("Will reuse existing configuration");
        // Copy existing values to secrets
        if (existing.anthropicKey) secrets.anthropic = { apiKey: existing.anthropicKey };
        if (existing.anthropicToken) secrets.anthropic = { ...secrets.anthropic, token: existing.anthropicToken };
        if (existing.openaiKey) secrets.openai = { apiKey: existing.openaiKey };
        if (existing.discordToken) secrets.discord = { token: existing.discordToken };
        if (existing.telegramToken) secrets.telegram = { token: existing.telegramToken };
      } else {
        info("Will configure new credentials");
      }
    }

    // Channels
    header("Chat platforms");
    
    let discordEnabled = false;
    let telegramEnabled = false;
    
    if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
      discordEnabled = !!existing.discordToken;
      telegramEnabled = !!existing.telegramToken;
      success("Reusing existing chat platform configuration:");
      if (discordEnabled) info("  - Discord");
      if (telegramEnabled) info("  - Telegram");
    } else {
      const chatChoice = await selectOption(rl, "Choose platform(s):", [
        "Discord",
        "Telegram",
        "Both",
      ]);
      
      discordEnabled = chatChoice === 0 || chatChoice === 2;
      telegramEnabled = chatChoice === 1 || chatChoice === 2;
      
      if (discordEnabled && !secrets.discord?.token) {
        console.log("");
        info("Discord developer portal: https://discord.com/developers/applications");
        info("Setup guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
        info("⚠️  Remember to enable MESSAGE CONTENT INTENT in the developer portal!");
        const token = await ask(rl, "Discord bot token (leave empty to set later): ");
        if (token) {
          secrets.discord = { token };
          success("Discord token set");
        }
      }
      
      if (telegramEnabled && !secrets.telegram?.token) {
        console.log("");
        info("Telegram BotFather: https://t.me/BotFather");
        const token = await ask(rl, "Telegram bot token (leave empty to set later): ");
        if (token) {
          secrets.telegram = { token };
          success("Telegram token set");
        }
      }
    }

    // Workspace
    header("Workspace");
    const defaultWorkspace = join(dirname(appConfigPath), "workspace");
    const workspace = (await ask(rl, `Workspace path [${defaultWorkspace}]: `)) || defaultWorkspace;
    success(`Workspace: ${workspace}`);

    // Provider selection
    header("AI provider setup");
    
    const providers: ProviderConfig[] = [];
    let priority = 1;
    
    // Check if we already have provider credentials from reuse
    const hasExistingProvider = reuseExisting && (existing?.anthropicKey || existing?.anthropicToken || existing?.openaiKey);
    
    if (hasExistingProvider) {
      success("Reusing existing AI provider configuration");
      
      if (existing?.anthropicKey || existing?.anthropicToken) {
        providers.push({
          id: "anthropic",
          model: DEFAULT_MODELS.anthropic,
          apiKey: existing.anthropicToken ? "secrets" : (existing.anthropicKey ? "secrets" : "env"),
          priority: priority++,
        } as ProviderConfig);
      }
      if (existing?.openaiKey) {
        providers.push({
          id: "openai",
          model: DEFAULT_MODELS.openai,
          apiKey: "secrets",
          priority: priority++,
        } as ProviderConfig);
      }
    } else {
      const aiChoice = await selectOption(rl, "Choose your AI provider(s):", [
        "Anthropic (Claude) - API Key or setup-token",
        "OpenAI (API key)",
        "OpenAI Codex (ChatGPT Plus/Pro OAuth)",
        "OpenAI-compatible (Ollama / vLLM / LM Studio)",
        "Multiple providers (fallback chain)",
      ]);
      
      // Anthropic
      if (aiChoice === 0 || aiChoice === 4) {
        console.log("");
        header("Anthropic Authentication");
        info("Supports two authentication methods:");
        info("");
        info("  • Setup-token (Claude Pro/Max subscription)");
        info("    Run `claude setup-token` to generate one");
        info("    Format: sk-ant-oat01-...");
        info("");
        info("  • API Key (pay-as-you-go)");
        info("    Get from console.anthropic.com");
        info("    Format: sk-ant-api03-...");
        console.log("");
        
        const tokenAns = await ask(rl, "Paste setup-token or API key (leave empty for env var): ");
        
        if (tokenAns) {
          if (isSetupToken(tokenAns)) {
            const error = validateAnthropicSetupToken(tokenAns);
            if (error) warn(`Setup-token validation warning: ${error}`);
            secrets.anthropic = { token: tokenAns };
            success("Setup-token saved (Claude Pro/Max)");
          } else {
            secrets.anthropic = { apiKey: tokenAns };
            success("API key saved");
          }
        }
        
        const model = (await ask(rl, `Model [${DEFAULT_MODELS.anthropic}]: `)) || DEFAULT_MODELS.anthropic;
        providers.push({
          id: "anthropic",
          model,
          apiKey: tokenAns ? "secrets" : "env",
          priority: priority++,
        } as ProviderConfig);
      }
      
      // OpenAI
      if (aiChoice === 1 || aiChoice === 4) {
        console.log("");
        info("OpenAI API keys: https://platform.openai.com/api-keys");
        const apiKey = await ask(rl, "OpenAI API key (leave empty for env var): ");
        
        if (apiKey) {
          secrets.openai = { apiKey };
          success("OpenAI API key saved");
        }
        
        const model = (await ask(rl, `Model [${DEFAULT_MODELS.openai}]: `)) || DEFAULT_MODELS.openai;
        providers.push({
          id: "openai",
          model,
          apiKey: apiKey ? "secrets" : "env",
          priority: priority++,
        } as ProviderConfig);
      }
      
      // OpenAI Codex (OAuth)
      if (aiChoice === 2 || aiChoice === 4) {
        console.log("");
        info("OpenAI Codex uses your ChatGPT Plus/Pro subscription via OAuth.");
        const runOAuth = await askYN(rl, "Start OAuth flow now?", false);
        
        if (runOAuth) {
          info("Starting OpenAI Codex OAuth flow...");
          await startOAuthFlow("openai-codex");
          success("OAuth completed");
        } else {
          info("Run `owliabot auth setup openai-codex` later to authenticate.");
        }
        
        providers.push({
          id: "openai-codex",
          model: DEFAULT_MODELS["openai-codex"],
          apiKey: "oauth",
          priority: priority++,
        } as ProviderConfig);
      }
      
      // OpenAI-compatible
      if (aiChoice === 3 || aiChoice === 4) {
        console.log("");
        info("OpenAI-compatible supports any server with the OpenAI v1 API:");
        info("  - Ollama:    http://localhost:11434/v1");
        info("  - vLLM:      http://localhost:8000/v1");
        info("  - LM Studio: http://localhost:1234/v1");
        info("  - LocalAI:   http://localhost:8080/v1");
        console.log("");
        
        const baseUrl = await ask(rl, "API base URL: ");
        if (baseUrl) {
          const model = (await ask(rl, `Model [${DEFAULT_MODELS["openai-compatible"]}]: `)) || DEFAULT_MODELS["openai-compatible"];
          const apiKey = await ask(rl, "API key (optional, leave empty if not required): ");
          
          providers.push({
            id: "openai-compatible",
            model,
            baseUrl,
            apiKey: apiKey || "none",
            priority: priority++,
          } as ProviderConfig);
          
          success(`OpenAI-compatible configured: ${baseUrl}`);
        }
      }
    }
    
    if (providers.length === 0) {
      warn("No provider configured. Add one later in the config file.");
      providers.push({
        id: "anthropic",
        model: DEFAULT_MODELS.anthropic,
        apiKey: "env",
        priority: 1,
      } as ProviderConfig);
    }

    // Gateway HTTP (optional)
    header("Gateway HTTP (optional)");
    info("Gateway HTTP provides a REST API for health checks and integrations.");
    
    const enableGateway = await askYN(rl, "Enable Gateway HTTP?", false);
    let gatewayConfig: { http?: { host: string; port: number; token?: string } } | undefined;
    
    if (enableGateway) {
      const port = parseInt(await ask(rl, "Port [8787]: ") || "8787", 10);
      const token = randomBytes(16).toString("hex");
      info(`Generated gateway token: ${token.slice(0, 8)}...`);
      
      gatewayConfig = {
        http: {
          host: "127.0.0.1",
          port,
          token,
        },
      };
      success(`Gateway HTTP enabled on port ${port}`);
    }

    // Default memory search config
    const memorySearchConfig: MemorySearchConfig = {
      enabled: true,
      provider: "sqlite",
      fallback: "naive",
      store: {
        path: join(workspace, "memory", "{agentId}.sqlite"),
      },
      extraPaths: [],
      sources: ["files"],
      indexing: {
        autoIndex: true,
        minIntervalMs: 5 * 60 * 1000,
      },
    };

    // Default system capability config
    const systemConfig: SystemCapabilityConfig = {
      exec: {
        commandAllowList: [
          // Read commands
          "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
          "date", "env", "which", "file", "stat", "du", "df", "curl",
          // Write commands (require confirmation when WriteGate is enabled)
          "rm", "mkdir", "touch", "mv", "cp",
        ],
        envAllowList: ["PATH", "HOME", "USER", "LANG", "LC_ALL"],
        timeoutMs: 60_000,
        maxOutputBytes: 256 * 1024,
      },
      web: {
        domainAllowList: [],
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

    // Build config
    const config: AppConfig = {
      workspace,
      providers,
      memorySearch: memorySearchConfig,
      system: systemConfig,
    };

    // Collect user allowlists for channels and writeGate
    const userAllowLists: { discord: string[]; telegram: string[] } = {
      discord: [],
      telegram: [],
    };

    if (discordEnabled) {
      header("Discord configuration");
      info("Ensure your bot has these permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History");
      info("See: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
      console.log("");
      
      const channelIds = await ask(rl, "Channel allowlist (comma-separated channel IDs, leave empty for all): ");
      const channelAllowList = channelIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const memberIds = await ask(rl, "Member allowlist - user IDs allowed to interact (comma-separated): ");
      const memberAllowList = memberIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      userAllowLists.discord = memberAllowList;

      config.discord = {
        requireMentionInGuild: true,
        channelAllowList,
        ...(memberAllowList.length > 0 && { memberAllowList }),
      };
      
      if (memberAllowList.length > 0) {
        success(`Discord member allowlist: ${memberAllowList.join(", ")}`);
      }
    }

    if (telegramEnabled) {
      header("Telegram configuration");
      
      const telegramUserIds = await ask(rl, "User allowlist - user IDs allowed to interact (comma-separated): ");
      const allowList = telegramUserIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      userAllowLists.telegram = allowList;

      config.telegram = {
        ...(allowList.length > 0 && { allowList }),
      };
      
      if (allowList.length > 0) {
        success(`Telegram user allowlist: ${allowList.join(", ")}`);
      }
    }

    // Optional Clawlet wallet setup
    const walletConfig = await runClawletOnboarding(rl, secrets);
    if (walletConfig.enabled) {
      config.wallet = {
        clawlet: {
          enabled: true,
          baseUrl: walletConfig.baseUrl,
          requestTimeout: 30000,
          defaultChainId: walletConfig.defaultChainId,
          defaultAddress: walletConfig.defaultAddress,
        },
      };
    }

    // Security: writeGate allowList
    // Combine all user IDs from channels as default
    const allUserIds = [...userAllowLists.discord, ...userAllowLists.telegram];
    
    if (allUserIds.length > 0) {
      header("Write tools security");
      info("Users in the write-tool allowlist can use file write/edit tools.");
      info(`Auto-included from channel allowlists: ${allUserIds.join(", ")}`);
      
      const writeAllowListAns = await ask(rl, "Additional user IDs to allow (comma-separated, leave empty to use only channel users): ");
      const additionalIds = writeAllowListAns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      
      // Merge channel user IDs with any additional IDs (deduplicated)
      const writeToolAllowList = [...new Set([...allUserIds, ...additionalIds])];

      if (writeToolAllowList.length > 0) {
        config.tools = {
          ...(config.tools ?? {}),
          allowWrite: true,
        };
        config.security = {
          writeGateEnabled: false, // Disable write-gate globally for smoother UX
          writeToolAllowList,
          writeToolConfirmation: false, // Disable confirmation for smoother UX
        };
        success("Filesystem write tools enabled (write_file/edit_file/apply_patch)");
        success(`Write-tool allowlist: ${writeToolAllowList.join(", ")}`);
        success("Write-gate globally disabled");
        success("Write-tool confirmation disabled (allowlisted users can write directly)");
      }
    }

    if (gatewayConfig) {
      config.gateway = gatewayConfig;
    }

    // Save config
    header("Saving configuration");

    await saveAppConfig(config, appConfigPath);
    success(`Saved config to: ${appConfigPath}`);

    // Save secrets if any
    const hasSecrets = Object.keys(secrets).length > 0;
    if (hasSecrets) {
      await saveSecrets(appConfigPath, secrets);
      success(`Saved secrets to: ${dirname(appConfigPath)}/secrets.yaml`);
    }

    // Initialize workspace
    const workspaceInit = await ensureWorkspaceInitialized({
      workspacePath: workspace,
    });
    if (workspaceInit.wroteBootstrap) {
      success("Created BOOTSTRAP.md for first-run setup");
    }
    if (workspaceInit.copiedSkills && workspaceInit.skillsDir) {
      success(`Copied bundled skills to: ${workspaceInit.skillsDir}`);
    }

    // Next steps
    header("Done!");
    console.log("Next steps:");
    
    if (discordEnabled && !secrets.discord?.token) {
      console.log("  • Set Discord token: owliabot token set discord");
    }
    if (telegramEnabled && !secrets.telegram?.token) {
      console.log("  • Set Telegram token: owliabot token set telegram");
    }
    if (providers.some(p => p.apiKey === "env")) {
      console.log("  • Set API key env var (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
    }
    if (providers.some(p => p.apiKey === "oauth" && p.id === "openai-codex")) {
      console.log("  • Complete OAuth: owliabot auth setup openai-codex");
    }
    
    console.log("  • Start the bot: owliabot start");
    console.log("");
    success("All set!");

  } finally {
    rl.close();
  }
}
