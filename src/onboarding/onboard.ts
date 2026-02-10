/**
 * Unified onboarding for OwliaBot (dev + docker modes)
 *
 * --docker flag switches to Docker-aware mode:
 *   - Generates docker-compose.yml
 *   - Writes config + secrets under OWLIABOT_HOME (~/.owliabot by default)
 *   - Prompts for a host port to expose Gateway HTTP
 *   - Applies bind-mount permission widening for Docker Desktop environments
 *
 * Without --docker:
 *   - Writes config + secrets under OWLIABOT_HOME (or ~/.owlia_dev when OWLIABOT_DEV=1)
 */

import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { createLogger } from "../utils/logger.js";
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig, LLMProviderId } from "./types.js";
import { saveAppConfig, DEFAULT_APP_CONFIG_PATH, IS_DEV_MODE } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, loadSecrets, type SecretsConfig } from "./secrets.js";
import { ensureOwliabotHomeEnv } from "../utils/paths.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: We intentionally avoid chmod hardening here to keep docker mode aligned
// with local mode's storage helpers behavior.

// ─────────────────────────────────────────────────────────────────────────────
// Unified config detection
// ─────────────────────────────────────────────────────────────────────────────

interface DetectedConfig extends ExistingConfig {
  openaiCompatKey?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
}

/**
 * Detect existing configuration for both dev and docker modes.
 * Implementation uses the same method for both modes: load secrets.yaml via the
 * secrets loader + check OAuth auth files.
 */
async function detectExistingConfig(
  _dockerMode: boolean,
  appConfigPath: string,
): Promise<DetectedConfig | null> {
  // Both modes: load via secrets loader + check OAuth auth files.
  // Caller should pass an appConfigPath whose sibling secrets.yaml is the desired
  // secrets location (local mode: config dir; docker mode: configDir).
  try {
    const existing = await loadSecrets(appConfigPath);
    if (!existing) return null;

    const result: DetectedConfig = {};
    let hasAny = false;

    if (existing.anthropic?.apiKey) { result.anthropicKey = existing.anthropic.apiKey; hasAny = true; }
    if (existing.anthropic?.token) { result.anthropicToken = existing.anthropic.token; hasAny = true; }
    if (existing.openai?.apiKey) { result.openaiKey = existing.openai.apiKey; hasAny = true; }
    if (existing["openai-compatible"]?.apiKey) { result.openaiCompatKey = existing["openai-compatible"].apiKey; hasAny = true; }
    if (existing.discord?.token) { result.discordToken = existing.discord.token; hasAny = true; }
    if (existing.telegram?.token) { result.telegramToken = existing.telegram.token; hasAny = true; }
    if (existing.gateway?.token) { result.gatewayToken = existing.gateway.token; hasAny = true; }

    // Check OAuth tokens (same location for both modes)
    const authDir = join(ensureOwliabotHomeEnv(), "auth");
    if (existsSync(join(authDir, "anthropic.json"))) { result.anthropicOAuth = true; hasAny = true; }
    if (existsSync(join(authDir, "openai-codex.json"))) { result.openaiOAuth = true; hasAny = true; }

    // Keep behavior parity: only return non-empty.
    return hasAny ? result : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardOptions {
  /** Path for app.yaml in dev mode */
  appConfigPath?: string;
  /** Enable Docker-aware mode */
  docker?: boolean;
  /** Output directory for docker-compose.yml (docker mode) */
  outputDir?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: provider Q&A
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderResult {
  providers: ProviderConfig[];
  secrets: SecretsConfig;
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

interface ProviderSetupState {
  providers: ProviderConfig[];
  secrets: SecretsConfig;
  priority: number;
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

async function maybeConfigureAnthropic(
  rl: ReturnType<typeof createInterface>,
  state: ProviderSetupState,
  aiChoice: number,
): Promise<void> {
  if (!(aiChoice === 0 || aiChoice === 4)) return;

  state.useAnthropic = true;
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
      const err = validateAnthropicSetupToken(tokenAns);
      if (err) warn(`Setup-token validation warning: ${err}`);
      state.secrets.anthropic = { token: tokenAns };
      success("Setup-token saved (Claude Pro/Max)");
    } else {
      state.secrets.anthropic = { apiKey: tokenAns };
      success("API key saved");
    }
  }

  const defaultModel = DEFAULT_MODELS.anthropic;
  const model = (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;
  const apiKeyValue = state.secrets.anthropic ? "secrets" : "env";

  state.providers.push({
    id: "anthropic",
    model,
    apiKey: apiKeyValue,
    priority: state.priority++,
  } as ProviderConfig);
}

async function maybeConfigureOpenAI(
  rl: ReturnType<typeof createInterface>,
  state: ProviderSetupState,
  aiChoice: number,
): Promise<void> {
  if (!(aiChoice === 1 || aiChoice === 4)) return;

  console.log("");
  info("OpenAI API keys: https://platform.openai.com/api-keys");
  const apiKey = await ask(rl, "OpenAI API key (leave empty for env var): ");
  if (apiKey) {
    state.secrets.openai = { apiKey };
    success("OpenAI API key saved");
  }

  const defaultModel = DEFAULT_MODELS.openai;
  const model = (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;
  state.providers.push({
    id: "openai",
    model,
    apiKey: apiKey ? "secrets" : "env",
    priority: state.priority++,
  } as ProviderConfig);
}

async function maybeConfigureOpenAICodex(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  state: ProviderSetupState,
  aiChoice: number,
): Promise<void> {
  if (!(aiChoice === 2 || aiChoice === 4)) return;

  state.useOpenaiCodex = true;
  console.log("");
  info("OpenAI Codex uses your ChatGPT Plus/Pro subscription via OAuth.");

  const runOAuth = await askYN(rl, "Start OAuth flow now?", false);
  if (runOAuth) {
    info("Starting OpenAI Codex OAuth flow...");
    // Pause onboard readline so OAuth's own readline doesn't fight for stdin
    rl.pause();
    try {
      await startOAuthFlow("openai-codex", { headless: dockerMode });
      success("OAuth completed");
    } finally {
      rl.resume();
    }
  } else {
    if (dockerMode) {
      info("Run after container starts: docker exec -it owliabot owliabot auth setup openai-codex");
    } else {
      info("Run `owliabot auth setup openai-codex` later to authenticate.");
    }
  }

  state.providers.push({
    id: "openai-codex",
    model: DEFAULT_MODELS["openai-codex"],
    apiKey: "oauth",
    priority: state.priority++,
  } as ProviderConfig);
}

async function maybeConfigureOpenAICompatible(
  rl: ReturnType<typeof createInterface>,
  state: ProviderSetupState,
  aiChoice: number,
): Promise<void> {
  if (!(aiChoice === 3 || aiChoice === 4)) return;

  console.log("");
  info("OpenAI-compatible supports any server with the OpenAI v1 API:");
  info("  - Ollama:    http://localhost:11434/v1");
  info("  - vLLM:      http://localhost:8000/v1");
  info("  - LM Studio: http://localhost:1234/v1");
  info("  - LocalAI:   http://localhost:8080/v1");
  console.log("");

  const baseUrl = await ask(rl, "API base URL: ");
  if (!baseUrl) return;

  const defaultModel = DEFAULT_MODELS["openai-compatible"];
  const model = (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;
  const apiKey = await ask(rl, "API key (optional, leave empty if not required): ");

  state.providers.push({
    id: "openai-compatible" as LLMProviderId,
    model,
    baseUrl,
    apiKey: apiKey ? "secrets" : "none",
    priority: state.priority++,
  } as ProviderConfig);

  if (apiKey) {
    state.secrets["openai-compatible"] = { apiKey };
  }
  success(`OpenAI-compatible configured: ${baseUrl}`);
}

async function askProviders(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
): Promise<ProviderResult> {
  const state: ProviderSetupState = {
    secrets: {},
    providers: [],
    priority: 1,
    useAnthropic: false,
    useOpenaiCodex: false,
  };

  const aiChoice = await selectOption(rl, "Choose your AI provider(s):", [
    "Anthropic (Claude) - API Key or setup-token",
    "OpenAI (API key)",
    "OpenAI Codex (ChatGPT Plus/Pro OAuth)",
    "OpenAI-compatible (Ollama / vLLM / LM Studio / etc.)",
    "Multiple providers (fallback chain)",
  ]);

  await maybeConfigureAnthropic(rl, state, aiChoice);
  await maybeConfigureOpenAI(rl, state, aiChoice);
  await maybeConfigureOpenAICodex(rl, dockerMode, state, aiChoice);
  await maybeConfigureOpenAICompatible(rl, state, aiChoice);

  return {
    providers: state.providers,
    secrets: state.secrets,
    useAnthropic: state.useAnthropic,
    useOpenaiCodex: state.useOpenaiCodex,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: channel Q&A
// ─────────────────────────────────────────────────────────────────────────────

interface ChannelResult {
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordToken: string;
  telegramToken: string;
}

async function askChannels(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
): Promise<ChannelResult> {
  const chatChoice = await selectOption(rl, "Choose platform(s):", [
    "Discord",
    "Telegram",
    "Both",
  ]);

  const discordEnabled = chatChoice === 0 || chatChoice === 2;
  const telegramEnabled = chatChoice === 1 || chatChoice === 2;
  let discordToken = "";
  let telegramToken = "";

  if (discordEnabled) {
    console.log("");
    info("Discord developer portal: https://discord.com/developers/applications");
    info("Setup guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
    info("Remember to enable MESSAGE CONTENT INTENT in the developer portal!");
    const token = await ask(
      rl,
      "Discord bot token (leave empty to set later): ",
    );
    if (token) {
      secrets.discord = { token };
      discordToken = token;
      success("Discord token set");
    }
  }

  if (telegramEnabled) {
    console.log("");
    info("Telegram BotFather: https://t.me/BotFather");
    const token = await ask(
      rl,
      "Telegram bot token (leave empty to set later): ",
    );
    if (token) {
      secrets.telegram = { token };
      telegramToken = token;
      success("Telegram token set");
    }
  }

  return { discordEnabled, telegramEnabled, discordToken, telegramToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single unified onboarding flow
// ─────────────────────────────────────────────────────────────────────────────

interface DockerPaths {
  /** Host directory where we write app.yaml + secrets.yaml */
  configDir: string;
  dockerConfigPath: string;
  shellConfigPath: string;
  outputDir: string;
}

function getConfigAnchorPath(
  options: OnboardOptions,
  dockerMode: boolean,
  dockerPaths: DockerPaths | null,
): string {
  if (dockerMode) {
    if (!dockerPaths) throw new Error("Internal error: dockerPaths is required in docker mode");
    return join(dockerPaths.configDir, "app.yaml");
  }
  return options.appConfigPath ?? DEFAULT_APP_CONFIG_PATH;
}

function initDockerPaths(options: OnboardOptions): DockerPaths {
  // Docker mode always uses the host user's config directory.
  // This keeps volume mounts stable across machines and avoids /app/... host paths
  // that Docker Desktop (macOS) cannot mount.
  const hostConfigDirAbs = join(homedir(), ".owliabot");
  const dockerConfigPath = "~/.owliabot";
  const shellConfigPath = "~/.owliabot";
  const outputDir = options.outputDir ?? ".";

  mkdirSync(hostConfigDirAbs, { recursive: true });

  return {
    configDir: hostConfigDirAbs,
    dockerConfigPath,
    shellConfigPath,
    outputDir,
  };
}

function printOnboardingBanner(dockerMode: boolean): void {
  if (dockerMode) {
    printBanner("(Docker)");
    return;
  }

  printBanner(IS_DEV_MODE ? "(dev mode)" : "");
  if (IS_DEV_MODE) {
    info("Dev mode enabled (OWLIABOT_DEV=1). Config will be saved to ~/.owlia_dev/");
  }
}

function printExistingConfigSummary(
  dockerMode: boolean,
  appConfigPath: string,
  existing: DetectedConfig,
): void {
  header("Existing configuration found");
  info(`Found existing config at: ${dirname(appConfigPath)}`);

  if (existing.anthropicKey) {
    const truncLen = dockerMode ? 10 : 15;
    info(`Found Anthropic API key: ${existing.anthropicKey.slice(0, truncLen)}...`);
  }
  if (existing.anthropicToken) info("Found Anthropic setup-token");
  if (dockerMode && existing.anthropicOAuth) info("Found Anthropic OAuth token");
  if (existing.openaiKey) info(`Found OpenAI API key: ${existing.openaiKey.slice(0, 10)}...`);
  if (dockerMode && existing.openaiOAuth) info("Found OpenAI OAuth token (openai-codex)");
  if (existing.discordToken) info(`Found Discord token: ${existing.discordToken.slice(0, 20)}...`);
  if (existing.telegramToken) info(`Found Telegram token: ${existing.telegramToken.slice(0, 10)}...`);
  if (dockerMode && existing.gatewayToken) info(`Found Gateway token: ${existing.gatewayToken.slice(0, 10)}...`);
}

async function promptReuseExistingConfig(
  rl: ReturnType<typeof createInterface>,
  existing: DetectedConfig | null,
): Promise<boolean> {
  if (!existing) return false;

  const reuse = await askYN(rl, "Do you want to reuse existing configuration?", true);
  if (reuse) success("Will reuse existing configuration");
  else info("Will configure new credentials");
  return reuse;
}

function reuseProvidersFromExisting(existing: DetectedConfig): ProviderResult {
  const secrets: SecretsConfig = {};
  const providers: ProviderConfig[] = [];
  let priority = 1;
  let useAnthropic = false;
  let useOpenaiCodex = false;

  // Anthropic
  if (existing.anthropicKey || existing.anthropicToken || existing.anthropicOAuth) {
    useAnthropic = true;
    if (existing.anthropicKey) secrets.anthropic = { apiKey: existing.anthropicKey };
    if (existing.anthropicToken) secrets.anthropic = { ...secrets.anthropic, token: existing.anthropicToken };
    const apiKey = (existing.anthropicKey || existing.anthropicToken) ? "secrets" : "oauth";
    providers.push({
      id: "anthropic",
      model: DEFAULT_MODELS.anthropic,
      apiKey,
      priority: priority++,
    } as ProviderConfig);
    success("Reusing Anthropic configuration");
  }

  // OpenAI
  if (existing.openaiKey) {
    secrets.openai = { apiKey: existing.openaiKey };
    providers.push({
      id: "openai",
      model: DEFAULT_MODELS.openai,
      apiKey: "secrets",
      priority: priority++,
    } as ProviderConfig);
    success("Reusing OpenAI configuration");
  }

  // OpenAI Codex (OAuth)
  if (existing.openaiOAuth) {
    useOpenaiCodex = true;
    providers.push({
      id: "openai-codex",
      model: DEFAULT_MODELS["openai-codex"],
      apiKey: "oauth",
      priority: priority++,
    } as ProviderConfig);
    success("Reusing OpenAI Codex (OAuth) configuration");
  }

  return { providers, secrets, useAnthropic, useOpenaiCodex };
}

async function getProvidersSetup(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ProviderResult> {
  header("AI provider setup");

  if (reuseExisting && existing) {
    const reused = reuseProvidersFromExisting(existing);
    if (reused.providers.length > 0) return reused;
  }

  const result = await askProviders(rl, dockerMode);
  if (result.providers.length > 0) return result;

  warn("No provider configured. Add one later in the config file.");
  return {
    providers: [{
      id: "anthropic",
      model: DEFAULT_MODELS.anthropic,
      apiKey: "env",
      priority: 1,
    } as ProviderConfig],
    secrets: {},
    useAnthropic: false,
    useOpenaiCodex: false,
  };
}

interface ChannelsSetup {
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordToken: string;
  telegramToken: string;
}

async function getChannelsSetup(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ChannelsSetup> {
  header("Chat platforms");

  if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
    let discordEnabled = false;
    let telegramEnabled = false;
    let discordToken = "";
    let telegramToken = "";

    success("Reusing existing chat platform configuration:");
    if (existing?.discordToken) {
      discordEnabled = true;
      discordToken = existing.discordToken;
      secrets.discord = { token: discordToken };
      info("  - Discord");
    }
    if (existing?.telegramToken) {
      telegramEnabled = true;
      telegramToken = existing.telegramToken;
      secrets.telegram = { token: telegramToken };
      info("  - Telegram");
    }

    if (!discordToken && !telegramToken) {
      warn("No chat platform token configured. Add one later in the config file.");
    }
    return { discordEnabled, telegramEnabled, discordToken, telegramToken };
  }

  const ch = await askChannels(rl, secrets);
  if (!ch.discordToken && !ch.telegramToken) {
    warn("No chat platform token configured. Add one later in the config file.");
  }
  return ch;
}

function ensureGatewayToken(
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): string {
  // Always provision a gateway token when generating config.
  // If a token already exists and the user opted to reuse config, keep it stable.
  const reused = reuseExisting && existing?.gatewayToken ? existing.gatewayToken : "";
  const token = secrets.gateway?.token || reused || randomBytes(16).toString("hex");
  secrets.gateway = { token };
  return token;
}

async function promptTimezone(
  rl: ReturnType<typeof createInterface>,
): Promise<string> {
  header("Timezone");
  const tz = await ask(rl, "Timezone [UTC]: ") || "UTC";
  success(`Timezone: ${tz}`);
  return tz;
}

interface DockerComposeSetup {
  gatewayToken: string;
  gatewayPort: string;
}

async function promptDockerComposeSetup(
  rl: ReturnType<typeof createInterface>,
  gatewayToken: string,
): Promise<DockerComposeSetup> {
  header("Docker");
  info("Choose a host port to expose Gateway HTTP (container listens on 8787).");
  const gatewayPort = await ask(rl, "Host port to expose the gateway [8787]: ") || "8787";
  return { gatewayToken, gatewayPort };
}

function buildDefaultMemorySearchConfig(workspace: string): MemorySearchConfig {
  // Use {workspace} placeholder so the store path resolves correctly even when
  // config.workspace is a relative path.
  void workspace;
  return {
    enabled: true,
    provider: "sqlite",
    fallback: "naive",
    store: {
      path: "{workspace}/memory/{agentId}.sqlite",
    },
    extraPaths: [],
    sources: ["files"],
    indexing: {
      autoIndex: true,
      minIntervalMs: 5 * 60 * 1000,
    },
  };
}

function buildDefaultSystemConfig(): SystemCapabilityConfig {
  return {
    exec: {
      commandAllowList: [
        "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
        "date", "env", "which", "file", "stat", "du", "df", "curl",
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
}

async function getWorkspacePath(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
): Promise<string> {
  // Intentionally not prompted:
  // - Keeps local + docker onboarding aligned
  // - Ensures the workspace is created next to app.yaml (portable across host + container)
  void rl;
  void dockerMode;
  void appConfigPath;
  return "workspace";
}

async function getGatewayConfig(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
): Promise<AppConfig["gateway"] | undefined> {
  void rl; // gateway config is always enabled; no prompts
  return {
    http: {
      host: dockerMode ? "0.0.0.0" : "127.0.0.1",
      port: 8787,
      token: "secrets",
    },
  };
}

type UserAllowLists = { discord: string[]; telegram: string[] };

async function configureDiscordConfig(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Discord configuration");
  info("Ensure your bot has these permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History");
  info("See: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
  console.log("");

  const channelIds = await ask(rl, "Channel allowlist (comma-separated channel IDs, leave empty for all): ");
  const channelAllowList = channelIds.split(",").map((s) => s.trim()).filter(Boolean);

  const memberIds = await ask(rl, "Member allowlist - user IDs allowed to interact (comma-separated): ");
  const memberAllowList = memberIds.split(",").map((s) => s.trim()).filter(Boolean);
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

async function configureTelegramConfig(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Telegram configuration");

  const telegramUserIds = await ask(rl, "User allowlist - user IDs allowed to interact (comma-separated): ");
  const allowList = telegramUserIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.telegram = allowList;

  config.telegram = {
    ...(allowList.length > 0 && { allowList }),
  };

  if (allowList.length > 0) {
    success(`Telegram user allowlist: ${allowList.join(", ")}`);
  }
}

async function configureWallet(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
  config: AppConfig,
): Promise<void> {
  const walletConfig = await runClawletOnboarding(rl, secrets);
  if (!walletConfig.enabled) return;

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

async function configureWriteToolsSecurity(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<string[] | null> {
  const allUserIds = [...userAllowLists.discord, ...userAllowLists.telegram];
  if (allUserIds.length === 0) return null;

  header("Write tools security");
  info("Users in the write-tool allowlist can use file write/edit tools.");
  info(`Auto-included from channel allowlists: ${allUserIds.join(", ")}`);

  const writeAllowListAns = await ask(
    rl,
    "Additional user IDs to allow (comma-separated, leave empty to use only channel users): ",
  );
  const additionalIds = writeAllowListAns.split(",").map((s) => s.trim()).filter(Boolean);
  const writeToolAllowList = [...new Set([...allUserIds, ...additionalIds])];
  if (writeToolAllowList.length === 0) return null;

  config.tools = {
    ...(config.tools ?? {}),
    allowWrite: true,
  };
  config.security = {
    writeGateEnabled: false,
    writeToolAllowList,
    writeToolConfirmation: false,
  };

  success("Filesystem write tools enabled (write_file/edit_file/apply_patch)");
  success(`Write-tool allowlist: ${writeToolAllowList.join(", ")}`);
  success("Write-gate globally disabled");
  success("Write-tool confirmation disabled (allowlisted users can write directly)");
  return writeToolAllowList;
}

async function buildAppConfigFromPrompts(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
  providers: ProviderConfig[],
  secrets: SecretsConfig,
  discordEnabled: boolean,
  telegramEnabled: boolean,
): Promise<{ config: AppConfig; workspacePath: string; writeToolAllowList: string[] | null }> {
  const workspace = await getWorkspacePath(rl, dockerMode, appConfigPath);
  const workspacePath = join(dirname(appConfigPath), workspace);
  const gateway = await getGatewayConfig(rl, dockerMode);

  const config: AppConfig = {
    workspace,
    providers,
    memorySearch: buildDefaultMemorySearchConfig(workspace),
    system: buildDefaultSystemConfig(),
    ...(gateway ? { gateway } : {}),
  };

  const userAllowLists: UserAllowLists = { discord: [], telegram: [] };
  if (discordEnabled) await configureDiscordConfig(rl, config, userAllowLists);
  if (telegramEnabled) await configureTelegramConfig(rl, config, userAllowLists);

  await configureWallet(rl, secrets, config);
  const writeToolAllowList = await configureWriteToolsSecurity(rl, config, userAllowLists);

  return { config, workspacePath, writeToolAllowList };
}

async function writeDockerConfigLocalStyle(
  paths: DockerPaths,
  config: AppConfig,
  secrets: SecretsConfig,
): Promise<void> {
  const dockerAppConfigPath = join(paths.configDir, "app.yaml");
  await saveAppConfig(config, dockerAppConfigPath);
  success(`Saved config to: ${dockerAppConfigPath}`);

  const hasSecrets = Object.keys(secrets).length > 0;
  if (!hasSecrets) return;

  await saveSecrets(dockerAppConfigPath, secrets);
  success(`Saved secrets to: ${join(paths.configDir, "secrets.yaml")}`);
}

async function writeDevConfig(
  config: AppConfig,
  secrets: SecretsConfig,
  appConfigPath: string,
): Promise<void> {
  await saveAppConfig(config, appConfigPath);
  success(`Saved config to: ${appConfigPath}`);

  const hasSecrets = Object.keys(secrets).length > 0;
  if (!hasSecrets) return;

  await saveSecrets(appConfigPath, secrets);
  success(`Saved secrets to: ${dirname(appConfigPath)}/secrets.yaml`);
}

function buildDockerComposeYaml(
  dockerConfigPath: string,
  envLines: string[],
  gatewayPort: string,
  defaultImage: string,
): string {
  const envBlock = envLines.length > 0
    ? envLines.map((v) => `      - ${v}`).join("\n")
    : "      - TZ=UTC";
  // Intentionally use `~` in docker-compose.yml so the file is portable and resolves
  // to the host user's home directory.
  return `# docker-compose.yml for OwliaBot
# Generated by onboard

services:
  owliabot:
    image: \${OWLIABOT_IMAGE:-${defaultImage}}
    container_name: owliabot
    restart: unless-stopped
    ports:
      - "127.0.0.1:${gatewayPort}:8787"
    volumes:
      - ${dockerConfigPath}:/home/owliabot/.owliabot
    environment:
${envBlock}
    command: ["start", "-c", "/home/owliabot/.owliabot/app.yaml"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s
`;
}

function buildDockerEnvLines(
  config: AppConfig,
  secrets: SecretsConfig,
  tz: string,
): string[] {
  const env: string[] = [];
  env.push(`TZ=${tz}`);

  // Channel tokens: only needed if user didn't store them in secrets.yaml
  if (config.discord && !secrets.discord?.token) {
    env.push("DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}");
  }
  if (config.telegram && !secrets.telegram?.token) {
    env.push("TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}");
  }

  // Provider keys: only needed when provider explicitly uses env auth
  if (config.providers.some((p) => p.id === "anthropic" && p.apiKey === "env")) {
    env.push("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}");
  }
  if (config.providers.some((p) => p.id === "openai" && p.apiKey === "env")) {
    env.push("OPENAI_API_KEY=${OPENAI_API_KEY}");
  }

  return env;
}

function printDockerNextSteps(
  paths: DockerPaths,
  gatewayPort: string,
  gatewayToken: string,
  tz: string,
  envLines: string[],
  defaultImage: string,
  useAnthropic: boolean,
  useOpenaiCodex: boolean,
  secrets: SecretsConfig,
): void {
  const envFlags = envLines.map((v) => `  -e ${v} \\`).join("\n");

  header("Docker commands");
  console.log("Docker run command:");
  console.log(`
docker run -d \\
  --name owliabot \\
  --restart unless-stopped \\
  -p 127.0.0.1:${gatewayPort}:8787 \\
  -v ${paths.shellConfigPath}:/home/owliabot/.owliabot \\
${envFlags}
  \${OWLIABOT_IMAGE:-${defaultImage}} \\
  start -c /home/owliabot/.owliabot/app.yaml
`);

  console.log("To start:");
  console.log("  docker compose up -d     # Docker Compose v2");
  console.log("  docker-compose up -d     # Docker Compose v1");

  header("Done");

  console.log("Files created:");
  console.log("  - ~/.owliabot/auth/          (OAuth tokens)");
  console.log("  - ~/.owliabot/app.yaml       (app config)");
  console.log("  - ~/.owliabot/secrets.yaml   (sensitive)");
  console.log("  - ~/.owliabot/workspace/     (workspace, skills, bootstrap)");
  console.log(`  - ${join(paths.outputDir, "docker-compose.yml")}       (Docker Compose)`);
  console.log("");

  const needsOAuth = useOpenaiCodex;
  console.log("Next steps:");
  console.log("  1. Start the container:");
  console.log("     docker compose up -d");
  console.log("");
  if (needsOAuth) {
    console.log("  2. Set up OAuth authentication (run after container is started):");
    if (useOpenaiCodex) {
      console.log("     docker exec -it owliabot owliabot auth setup openai-codex");
    }
    console.log("");
    console.log("  3. Check logs:");
  } else {
    console.log("  2. Check logs:");
  }
  console.log("     docker compose logs -f");
  console.log("");

  console.log("Gateway HTTP:");
  console.log(`  - URL:   http://localhost:${gatewayPort}`);
  console.log(`  - Token: ${gatewayToken.slice(0, 8)}...`);
  console.log("");
}

async function initDevWorkspace(
  workspace: string,
  writeToolAllowList: string[] | null,
): Promise<void> {
  const workspaceInit = await ensureWorkspaceInitialized({ workspacePath: workspace });
  maybeUpdateWorkspacePolicyAllowedUsers(workspace, writeToolAllowList);
  if (workspaceInit.wroteBootstrap) {
    success("Created BOOTSTRAP.md for first-run setup");
  }
  if (workspaceInit.copiedSkills && workspaceInit.skillsDir) {
    success(`Copied bundled skills to: ${workspaceInit.skillsDir}`);
  }
}

function tryMakeTreeWritableForDocker(rootPath: string): void {
  // Docker bind-mounts often run the container as a different UID/GID than the
  // host user. If the host workspace is created with default 755/644 modes,
  // the container user may not be able to write audit/memory/config files.
  //
  // Best-effort: widen permissions to a+rwX for the bind-mounted tree.
  // This is only applied in docker mode.
  if (process.platform === "win32") return;

  const stack: string[] = [rootPath];
  while (stack.length > 0) {
    const p = stack.pop();
    if (!p) break;

    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }

    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      try { chmodSync(p, 0o777); } catch { /* best-effort */ }
      let entries;
      try { entries = readdirSync(p, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        stack.push(join(p, ent.name));
      }
      continue;
    }

    if (st.isFile()) {
      try { chmodSync(p, 0o666); } catch { /* best-effort */ }
    }
  }
}

function printDevNextStepsText(
  discordEnabled: boolean,
  telegramEnabled: boolean,
  secrets: SecretsConfig,
  providers: ProviderConfig[],
): void {
  header("Done!");
  console.log("Next steps:");

  if (discordEnabled && !secrets.discord?.token) {
    console.log("  • Set Discord token: owliabot token set discord");
  }
  if (telegramEnabled && !secrets.telegram?.token) {
    console.log("  • Set Telegram token: owliabot token set telegram");
  }
  if (providers.some((p) => p.apiKey === "env")) {
    console.log("  • Set API key env var (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
  }
  if (providers.some((p) => p.apiKey === "oauth" && p.id === "openai-codex")) {
    console.log("  • Complete OAuth: owliabot auth setup openai-codex");
  }

  if (secrets.gateway?.token) {
    console.log(`  • Gateway HTTP: http://localhost:8787 (token: ${secrets.gateway.token.slice(0, 8)}...)`);
  }

  console.log("  • Start the bot: owliabot start");
  console.log("");
}

async function printDevNextSteps(
  workspacePath: string,
  discordEnabled: boolean,
  telegramEnabled: boolean,
  secrets: SecretsConfig,
  providers: ProviderConfig[],
  writeToolAllowList: string[] | null,
): Promise<void> {
  await initDevWorkspace(workspacePath, writeToolAllowList);
  printDevNextStepsText(discordEnabled, telegramEnabled, secrets, providers);
}

function maybeUpdateWorkspacePolicyAllowedUsers(
  workspacePath: string,
  allowedUserIds: string[] | null,
): void {
  if (!allowedUserIds || allowedUserIds.length === 0) return;
  const policyPath = join(workspacePath, "policy.yml");
  if (!existsSync(policyPath)) return;

  try {
    const raw = readFileSync(policyPath, "utf-8");
    const doc = (yamlParse(raw) ?? {}) as Record<string, any>;
    const defaults = (doc.defaults ?? {}) as Record<string, any>;
    const current = defaults.allowedUsers as unknown;

    if (Array.isArray(current)) {
      // Merge to avoid clobbering manual edits.
      const merged = [...new Set([...current, ...allowedUserIds])];
      defaults.allowedUsers = merged;
    } else if (current === "assignee-only" || current == null) {
      defaults.allowedUsers = allowedUserIds;
    } else {
      // Unknown type; leave as-is.
      return;
    }

    doc.defaults = defaults;
    writeFileSync(policyPath, yamlStringify(doc, { indent: 2 }), "utf-8");
    log.info(`Updated policy allowedUsers in ${policyPath}`);
  } catch (err) {
    warn(`Failed to update policy.yml allowedUsers: ${(err as Error).message}`);
  }
}

function deriveWriteToolAllowListFromConfig(config: AppConfig): string[] | null {
  const sec = (config as any).security as { writeToolAllowList?: unknown } | undefined;
  const fromSecurity = sec?.writeToolAllowList;
  if (Array.isArray(fromSecurity) && fromSecurity.length > 0) {
    return fromSecurity.filter((v) => typeof v === "string" && v.trim().length > 0);
  }

  // Fallback: if writeToolAllowList wasn't set (e.g. reused config path),
  // derive IDs from channel allowlists.
  const ids = new Set<string>();
  const discord = (config as any).discord as { memberAllowList?: unknown } | undefined;
  const telegram = (config as any).telegram as { allowList?: unknown } | undefined;

  if (Array.isArray(discord?.memberAllowList)) {
    for (const v of discord.memberAllowList) {
      if (typeof v === "string" && v.trim()) ids.add(v.trim());
    }
  }
  if (Array.isArray(telegram?.allowList)) {
    for (const v of telegram.allowList) {
      if (typeof v === "string" && v.trim()) ids.add(v.trim());
    }
  }

  return ids.size > 0 ? [...ids] : null;
}

export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const dockerMode = options.docker === true;
  const dockerPaths = dockerMode ? initDockerPaths(options) : null;
  const appConfigPath = getConfigAnchorPath(options, dockerMode, dockerPaths);
  const defaultImage = "ghcr.io/owliabot/owliabot:latest";

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    printOnboardingBanner(dockerMode);

    const existing = await detectExistingConfig(dockerMode, appConfigPath);
    if (existing) printExistingConfigSummary(dockerMode, appConfigPath, existing);
    const reuseExisting = await promptReuseExistingConfig(rl, existing);

    const providerResult = await getProvidersSetup(rl, dockerMode, existing, reuseExisting);
    const secrets: SecretsConfig = { ...providerResult.secrets };

    const channels = await getChannelsSetup(rl, secrets, existing, reuseExisting);

    const tz = await promptTimezone(rl);
    const gatewayToken = ensureGatewayToken(secrets, existing, reuseExisting);

    let dockerCompose: DockerComposeSetup | null = null;
    if (dockerMode) {
      dockerCompose = await promptDockerComposeSetup(rl, gatewayToken);
    }

    const { config, workspacePath, writeToolAllowList } = await buildAppConfigFromPrompts(
      rl,
      dockerMode,
      appConfigPath,
      providerResult.providers,
      secrets,
      channels.discordEnabled,
      channels.telegramEnabled,
    );
    const resolvedWriteToolAllowList = deriveWriteToolAllowListFromConfig(config) ?? writeToolAllowList;
    config.timezone = tz;

    header(dockerMode ? "Writing config" : "Saving configuration");
    if (dockerMode) {
      if (!dockerPaths || !dockerCompose) throw new Error("Internal error: missing docker paths/docker setup");
      await writeDockerConfigLocalStyle(dockerPaths, config, secrets);

      // Docker mode: initialize a host workspace directory that is bind-mounted into the container.
      // This matches local mode behavior (BOOTSTRAP.md + bundled skills copy).
      await initDevWorkspace(workspacePath, resolvedWriteToolAllowList);
      // Ensure the container's UID/GID can write into bind-mounted dirs (workspace, auth, etc.).
      mkdirSync(join(dockerPaths.configDir, "auth"), { recursive: true });
      tryMakeTreeWritableForDocker(dockerPaths.configDir);

      const dockerEnv = buildDockerEnvLines(config, secrets, tz);

      const composePath = join(dockerPaths.outputDir, "docker-compose.yml");
      writeFileSync(
        composePath,
        buildDockerComposeYaml(dockerPaths.dockerConfigPath, dockerEnv, dockerCompose.gatewayPort, defaultImage),
      );
      success(`Wrote ${composePath}`);

      printDockerNextSteps(
        dockerPaths,
        dockerCompose.gatewayPort,
        gatewayToken,
        tz,
        dockerEnv,
        defaultImage,
        providerResult.useAnthropic,
        providerResult.useOpenaiCodex,
        secrets,
      );
    } else {
      await writeDevConfig(config, secrets, appConfigPath);
      await printDevNextSteps(
        workspacePath,
        channels.discordEnabled,
        channels.telegramEnabled,
        secrets,
        providerResult.providers,
        resolvedWriteToolAllowList,
      );
    }

    success("All set!");

  } finally {
    rl.close();
  }
}
