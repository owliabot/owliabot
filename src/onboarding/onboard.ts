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
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig, LLMProviderId } from "./types.js";
import { saveAppConfig, DEFAULT_APP_CONFIG_PATH, IS_DEV_MODE } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, loadSecrets, type SecretsConfig } from "./secrets.js";
import { ensureOwliabotHomeEnv } from "../utils/paths.js";
import { ensureWorkspaceInitialized } from "../workspace/init.js";
import { runClawletOnboarding } from "./clawlet-onboard.js";
import { validateAnthropicSetupToken, isSetupToken } from "../auth/setup-token.js";
import {
  AbortError,
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: We intentionally avoid chmod hardening here to keep docker mode aligned
// with local mode's storage helpers behavior.

function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.trim().length > 0) return tz.trim();
  } catch {
    // ignore
  }
  return "UTC";
}

function injectTimezoneComment(yaml: string): string {
  const comment =
    "# Timezone was auto-detected during setup. Edit this value to override.";
  return yaml.replace(
    /^(timezone:\s*.*)$/m,
    `${comment}\n$1`,
  );
}

async function saveAppConfigWithComments(config: AppConfig, path: string): Promise<void> {
  await saveAppConfig(config, path);
  try {
    const raw = readFileSync(path, "utf-8");
    const next = injectTimezoneComment(raw);
    if (next !== raw) writeFileSync(path, next, "utf-8");
  } catch {
    // best-effort
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified config detection
// ─────────────────────────────────────────────────────────────────────────────

type TelegramGroups = NonNullable<NonNullable<AppConfig["telegram"]>["groups"]>;

interface DetectedConfig extends ExistingConfig {
  openaiCompatKey?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
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
  try {
    const result: DetectedConfig = {};
    let hasAny = false;

    // Both modes: load via secrets loader.
    // Caller should pass an appConfigPath whose sibling secrets.yaml is the desired
    // secrets location (local mode: config dir; docker mode: configDir).
    const secrets = await loadSecrets(appConfigPath);
    if (secrets) {
      if (secrets.anthropic?.apiKey) { result.anthropicKey = secrets.anthropic.apiKey; hasAny = true; }
      if (secrets.anthropic?.token) { result.anthropicToken = secrets.anthropic.token; hasAny = true; }
      if (secrets.openai?.apiKey) { result.openaiKey = secrets.openai.apiKey; hasAny = true; }
      if (secrets["openai-compatible"]?.apiKey) { result.openaiCompatKey = secrets["openai-compatible"].apiKey; hasAny = true; }
      if (secrets.discord?.token) { result.discordToken = secrets.discord.token; hasAny = true; }
      if (secrets.telegram?.token) { result.telegramToken = secrets.telegram.token; hasAny = true; }
      if (secrets.gateway?.token) { result.gatewayToken = secrets.gateway.token; hasAny = true; }

      // Check OAuth tokens (same location for both modes).
      // Keep prior behavior: only check OAuth when secrets.yaml exists to avoid
      // surprising prompts in test/CI environments.
      const authDir = join(ensureOwliabotHomeEnv(), "auth");
      if (existsSync(join(authDir, "anthropic.json"))) { result.anthropicOAuth = true; hasAny = true; }
      if (existsSync(join(authDir, "openai-codex.json"))) { result.openaiOAuth = true; hasAny = true; }
    }

    // Best-effort: detect Telegram allowList/groups from app.yaml so we can offer reuse.
    try {
      if (existsSync(appConfigPath)) {
        const raw = yamlParse(readFileSync(appConfigPath, "utf-8")) as any;
        const tg = raw?.telegram;
        if (tg && typeof tg === "object") {
          const allowList = Array.isArray(tg.allowList)
            ? tg.allowList.map((v: unknown) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
            : [];
          if (allowList.length > 0) {
            result.telegramAllowList = allowList;
            hasAny = true;
          }

          const groups = tg.groups && typeof tg.groups === "object"
            ? (tg.groups as TelegramGroups)
            : undefined;
          if (groups && Object.keys(groups).length > 0) {
            result.telegramGroups = groups;
            hasAny = true;
          }

          // If the user stored the token directly in app.yaml, treat it as an existing token
          // for reuse prompts. Ignore env placeholders like "${TELEGRAM_BOT_TOKEN}" so we
          // don't copy them into secrets.yaml and break env-based Docker setups.
          if (!result.telegramToken && typeof tg.token === "string") {
            const token = tg.token.trim();
            const isEnvPlaceholder = token.startsWith("${") && token.endsWith("}");
            if (token.length > 0 && !isEnvPlaceholder) {
              result.telegramToken = token;
              hasAny = true;
            }
          }
        }
      }
    } catch {
      // ignore
    }

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

  header("Connect Claude (Anthropic)");
  info("Quick question: how do you want to authenticate?");
  info("");
  info("  • Claude subscription (Pro/Max): use a setup-token");
  info("    Generate one with: `claude setup-token`");
  info("    It looks like: sk-ant-oat01-...");
  info("");
  info("  • Pay-as-you-go: use an API key from console.anthropic.com");
  info("    It looks like: sk-ant-api03-...");
  console.log("");

  const tokenAns = await ask(
    rl,
    "Paste your setup-token or API key (or press Enter to use an environment variable): ",
    true,
  );
  if (tokenAns) {
    if (isSetupToken(tokenAns)) {
      const err = validateAnthropicSetupToken(tokenAns);
      if (err) warn(`Quick check: ${err}`);
      state.secrets.anthropic = { token: tokenAns };
      success("Got it. I'll use that setup-token.");
    } else {
      state.secrets.anthropic = { apiKey: tokenAns };
      success("Got it. I'll use that API key.");
    }
  }

  const defaultModel = DEFAULT_MODELS.anthropic;
  const model = (await ask(rl, `Which model should I use? [${defaultModel}]: `)) || defaultModel;
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
  info("If you don't have an OpenAI API key yet, you can create one here: https://platform.openai.com/api-keys");
  const apiKey = await ask(
    rl,
    "Paste your OpenAI API key (or press Enter to use an environment variable): ",
    true,
  );
  if (apiKey) {
    state.secrets.openai = { apiKey };
    success("Got it. I'll use that OpenAI API key.");
  }

  const defaultModel = DEFAULT_MODELS.openai;
  const model = (await ask(rl, `Which model should I use? [${defaultModel}]: `)) || defaultModel;
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
  info("If you have ChatGPT Plus/Pro, you can connect via OAuth (no API key needed).");

  const runOAuth = await askYN(rl, "Want to connect it now?", false);
  if (runOAuth) {
    info("Starting the sign-in flow...");
    // Pause onboard readline so OAuth's own readline doesn't fight for stdin
    rl.pause();
    try {
      await startOAuthFlow("openai-codex", { headless: dockerMode });
      success("You're connected.");
    } finally {
      rl.resume();
    }
  } else {
    if (dockerMode) {
      info("After the container is running, run: docker exec -it owliabot owliabot auth setup openai-codex");
    } else {
      info("You can connect later with: `owliabot auth setup openai-codex`");
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
  info("Using a local or self-hosted model?");
  info("Give me the base URL for its OpenAI-compatible /v1 endpoint. Examples:");
  info("  - Ollama:    http://localhost:11434/v1");
  info("  - vLLM:      http://localhost:8000/v1");
  info("  - LM Studio: http://localhost:1234/v1");
  info("  - LocalAI:   http://localhost:8080/v1");
  console.log("");

  const baseUrl = await ask(rl, "Base URL (ends with /v1): ");
  if (!baseUrl) return;

  const defaultModel = DEFAULT_MODELS["openai-compatible"];
  const model = (await ask(rl, `Which model should I use? [${defaultModel}]: `)) || defaultModel;
  const apiKey = await ask(rl, "API key (optional; press Enter if not needed): ", true);

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
  success(`Great. I'll use ${baseUrl}`);
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

  const aiChoice = await selectOption(rl, "Which AI should OwliaBot use?", [
    "Claude (Anthropic) (setup-token or API key)",
    "OpenAI (API key)",
    "OpenAI Codex (ChatGPT Plus/Pro, OAuth)",
    "OpenAI-compatible (self-hosted or local)",
    "Use multiple providers (fallback chain)",
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
  reuseTelegramConfig: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
}

async function askChannels(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
): Promise<ChannelResult> {
  const chatChoice = await selectOption(rl, "Where should OwliaBot chat with you?", [
    "Discord",
    "Telegram",
    "Both (Discord + Telegram)",
  ]);

  const discordEnabled = chatChoice === 0 || chatChoice === 2;
  const telegramEnabled = chatChoice === 1 || chatChoice === 2;
  let discordToken = "";
  let telegramToken = "";
  let reuseTelegramConfig = false;
  let telegramAllowList: string[] | undefined;
  let telegramGroups: TelegramGroups | undefined;

  // Telegram reuse prompt (only when user selected Telegram and we detected existing settings).
  if (telegramEnabled && existing) {
    const allowCount = existing.telegramAllowList?.length ?? 0;
    const groupCount = existing.telegramGroups ? Object.keys(existing.telegramGroups).length : 0;
    const hasExistingTelegram = Boolean(existing.telegramToken) || allowCount > 0 || groupCount > 0;

    if (hasExistingTelegram) {
      console.log("");
      info(`I found existing Telegram settings (allowed users: ${allowCount}, groups: ${groupCount}).`);
      const reuse = await askYN(
        rl,
        "Reuse your existing Telegram setup?",
        true,
      );
      if (reuse) {
        reuseTelegramConfig = true;
        telegramAllowList = existing.telegramAllowList;
        telegramGroups = existing.telegramGroups;

        if (existing.telegramToken) {
          secrets.telegram = { token: existing.telegramToken };
          telegramToken = existing.telegramToken;
        }
        success("Got it. I'll reuse your existing Telegram configuration.");
      }
    }
  }

  if (discordEnabled) {
    console.log("");
    info("You'll find your bot token in the Discord developer portal: https://discord.com/developers/applications");
    info("Guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
    info("Quick reminder: enable MESSAGE CONTENT INTENT, otherwise I won't receive messages.");
    const token = await ask(
      rl,
      "Paste your Discord bot token (or press Enter to do this later): ",
      true,
    );
    if (token) {
      secrets.discord = { token };
      discordToken = token;
      success("Got it. I'll use that Discord token.");
    }
  }

  if (telegramEnabled) {
    // If we chose to reuse and a token exists, skip the token prompt.
    if (!(reuseTelegramConfig && telegramToken)) {
      console.log("");
      info("Create a bot with BotFather: https://t.me/BotFather");
      const token = await ask(
        rl,
        "Paste your Telegram bot token (or press Enter to do this later): ",
        true,
      );
      if (token) {
        secrets.telegram = { token };
        telegramToken = token;
        success("Got it. I'll use that Telegram token.");
      }
    }
  }

  return {
    discordEnabled,
    telegramEnabled,
    discordToken,
    telegramToken,
    reuseTelegramConfig,
    telegramAllowList,
    telegramGroups,
  };
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
    info("Dev mode is on (OWLIABOT_DEV=1). I'll save settings to ~/.owlia_dev/.");
  }
}

function printExistingConfigSummary(
  dockerMode: boolean,
  appConfigPath: string,
  existing: DetectedConfig,
): void {
  header("I found an existing setup");
  info(`Settings folder: ${dirname(appConfigPath)}`);

  if (existing.anthropicKey) {
    const truncLen = dockerMode ? 10 : 15;
    info(`Anthropic: API key is set (${existing.anthropicKey.slice(0, truncLen)}...)`);
  }
  if (existing.anthropicToken) info("Anthropic: setup-token is set");
  if (dockerMode && existing.anthropicOAuth) info("Anthropic: OAuth token is present");
  if (existing.openaiKey) info(`OpenAI: API key is set (${existing.openaiKey.slice(0, 10)}...)`);
  if (dockerMode && existing.openaiOAuth) info("OpenAI Codex: OAuth token is present");
  if (existing.discordToken) info(`Discord: token is set (${existing.discordToken.slice(0, 20)}...)`);
  if (existing.telegramToken) info(`Telegram: token is set (${existing.telegramToken.slice(0, 10)}...)`);
  if (dockerMode && existing.gatewayToken) info(`Gateway: token is set (${existing.gatewayToken.slice(0, 10)}...)`);
}

async function promptReuseExistingConfig(
  rl: ReturnType<typeof createInterface>,
  existing: DetectedConfig | null,
): Promise<boolean> {
  if (!existing) return false;

  const reuse = await askYN(rl, "Want to keep using these settings?", true);
  if (reuse) success("Great. I'll keep your existing settings.");
  else info("Okay. We'll set things up fresh.");
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
    success("Using your existing Anthropic setup.");
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
    success("Using your existing OpenAI setup.");
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
    success("Using your existing OpenAI Codex sign-in.");
  }

  return { providers, secrets, useAnthropic, useOpenaiCodex };
}

async function getProvidersSetup(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ProviderResult> {
  header("AI");

  if (reuseExisting && existing) {
    const reused = reuseProvidersFromExisting(existing);
    if (reused.providers.length > 0) return reused;
  }

  const result = await askProviders(rl, dockerMode);
  if (result.providers.length > 0) return result;

  warn("No AI provider yet. You can add one later in app.yaml.");
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
  reuseTelegramConfig: boolean;
  telegramAllowList?: string[];
  telegramGroups?: TelegramGroups;
}

async function getChannelsSetup(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  secrets: SecretsConfig,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ChannelsSetup> {
  header("Chat");

  if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
    let discordEnabled = false;
    let telegramEnabled = false;
    let discordToken = "";
    let telegramToken = "";
    let reuseTelegramConfig = false;
    let telegramAllowList: string[] | undefined;
    let telegramGroups: TelegramGroups | undefined;

    success("Using your existing chat setup:");
	    if (existing?.discordToken) {
	      discordEnabled = true;
	      discordToken = existing.discordToken;
	      secrets.discord = { token: discordToken };
	      info("  - Discord");
	    }
	    if (existing?.telegramToken) {
	      telegramEnabled = true;
	      info("  - Telegram");

	      // Docker mode: keep behavior aligned with interactive mode by asking whether to reuse
	      // Telegram config (token + allowed users/groups). Default is yes.
	      const allowCount = existing.telegramAllowList?.length ?? 0;
	      const groupCount = existing.telegramGroups ? Object.keys(existing.telegramGroups).length : 0;
	      if (dockerMode) {
	        console.log("");
	        const details =
	          allowCount > 0 || groupCount > 0
	            ? `allowed users: ${allowCount}, groups: ${groupCount}`
	            : "token only";
	        info(`I found existing Telegram settings (${details}).`);
	        const reuse = await askYN(rl, "Reuse your existing Telegram setup?", true);
	        if (reuse) {
	          reuseTelegramConfig = true;
	          telegramAllowList = existing.telegramAllowList;
	          telegramGroups = existing.telegramGroups;
	        } else {
	          reuseTelegramConfig = false;
	        }
	      } else {
	        reuseTelegramConfig = true;
	        telegramAllowList = existing.telegramAllowList;
	        telegramGroups = existing.telegramGroups;
	      }

	      // Token: reuse by default, but let user override in docker mode when reuse was declined.
	      if (reuseTelegramConfig) {
	        telegramToken = existing.telegramToken;
	        secrets.telegram = { token: telegramToken };
	      } else {
	        console.log("");
	        info("Create a bot with BotFather: https://t.me/BotFather");
	        const token = await ask(
	          rl,
	          "Paste your Telegram bot token (or press Enter to do this later): ",
	          true,
	        );
	        if (token) {
	          telegramToken = token;
	          secrets.telegram = { token };
	        }
	      }
	    }

    if (!discordToken && !telegramToken) {
      warn("No chat token yet. You can add it later.");
    }
    return {
      discordEnabled,
      telegramEnabled,
      discordToken,
      telegramToken,
      // If we're reusing existing credentials, also keep existing Telegram config
      // to avoid overwriting allowList/groups with prompts.
      reuseTelegramConfig,
      telegramAllowList,
      telegramGroups,
    };
  }

  const ch = await askChannels(rl, secrets, existing);
  if (!ch.discordToken && !ch.telegramToken) {
    warn("No chat token yet. You can add it later.");
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

interface DockerComposeSetup {
  gatewayToken: string;
  gatewayPort: string;
}

async function promptDockerComposeSetup(
  rl: ReturnType<typeof createInterface>,
  gatewayToken: string,
): Promise<DockerComposeSetup> {
  header("Docker");
  info("Which port should I use on your machine for Gateway HTTP? (The container listens on 8787)");
  const gatewayPort = await ask(rl, "Host port [8787]: ") || "8787";
  return { gatewayToken, gatewayPort };
}

function buildDefaultMemorySearchConfig(): MemorySearchConfig {
  // Use {workspace} placeholder so the store path resolves correctly even when
  // config.workspace is a relative path.
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
      // Strict by default in local mode. In docker mode, the compose template
      // binds the published port to 127.0.0.1 on the host.
      ...(dockerMode ? {} : { allowlist: ["127.0.0.1"] }),
    },
  };
}

type UserAllowLists = { discord: string[]; telegram: string[] };

async function configureDiscordConfig(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Discord");
  info("Quick checklist: View Channels, Send Messages, Send Messages in Threads, Read Message History");
  info("Guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
  console.log("");

  const channelIds = await ask(rl, "Which channels should I respond in? (comma-separated channel IDs; press Enter for all): ");
  const channelAllowList = channelIds.split(",").map((s) => s.trim()).filter(Boolean);

  const memberIds = await ask(rl, "Who can talk to me? (comma-separated Discord user IDs; press Enter to skip): ");
  const memberAllowList = memberIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.discord = memberAllowList;

  config.discord = {
    requireMentionInGuild: true,
    channelAllowList,
    ...(memberAllowList.length > 0 && { memberAllowList }),
  };

  if (memberAllowList.length > 0) {
    success(`I'll only respond to these Discord user IDs: ${memberAllowList.join(", ")}`);
  }
}

async function configureTelegramConfig(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<void> {
  header("Telegram");

  const telegramUserIds = await ask(rl, "Who can talk to me? (comma-separated Telegram user IDs; press Enter to skip): ");
  const allowList = telegramUserIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.telegram = allowList;

  config.telegram = {
    ...(allowList.length > 0 && { allowList }),
  };

  if (allowList.length > 0) {
    success(`I'll only respond to these Telegram user IDs: ${allowList.join(", ")}`);
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

async function buildAppConfigFromPrompts(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
  providers: ProviderConfig[],
  secrets: SecretsConfig,
  discordEnabled: boolean,
  telegramEnabled: boolean,
  reuseTelegramConfig: boolean,
  telegramAllowList: string[] | undefined,
  telegramGroups: TelegramGroups | undefined,
): Promise<{ config: AppConfig; workspacePath: string; writeToolAllowList: string[] | null }> {
  // Keep local + docker onboarding aligned: workspace is always created next to app.yaml
  // and referenced via a relative path for portability.
  const workspace = "workspace";
  const workspacePath = join(dirname(appConfigPath), workspace);
  const gateway = await getGatewayConfig(rl, dockerMode);

  const config: AppConfig = {
    workspace,
    providers,
    memorySearch: buildDefaultMemorySearchConfig(),
    system: buildDefaultSystemConfig(),
    ...(gateway ? { gateway } : {}),
  };

  const userAllowLists: UserAllowLists = { discord: [], telegram: [] };
  if (discordEnabled) await configureDiscordConfig(rl, config, userAllowLists);
  if (telegramEnabled) {
    if (reuseTelegramConfig) {
      const allowList = (telegramAllowList ?? []).map((s) => s.trim()).filter(Boolean);
      userAllowLists.telegram = allowList;
      config.telegram = {
        ...(allowList.length > 0 && { allowList }),
        ...(telegramGroups && Object.keys(telegramGroups).length > 0 && { groups: telegramGroups }),
      };
    } else {
      await configureTelegramConfig(rl, config, userAllowLists);
    }
  }

  await configureWallet(rl, secrets, config);

  // Auto-derive writeToolAllowList from channel allowlists (no interactive prompt).
  const allUserIds = [...new Set([...userAllowLists.discord, ...userAllowLists.telegram])];
  const writeToolAllowList = allUserIds.length > 0 ? allUserIds : null;
  if (writeToolAllowList) {
    config.tools = {
      ...(config.tools ?? {}),
      allowWrite: true,
    };
    config.security = {
      writeGateEnabled: false,
      writeToolAllowList,
      writeToolConfirmation: false,
    };
  }

  return { config, workspacePath, writeToolAllowList };
}

async function writeDockerConfigLocalStyle(
  paths: DockerPaths,
  config: AppConfig,
  secrets: SecretsConfig,
): Promise<void> {
  const dockerAppConfigPath = join(paths.configDir, "app.yaml");
  await saveAppConfigWithComments(config, dockerAppConfigPath);
  success(`Saved your settings in ${dockerAppConfigPath}`);

  const hasSecrets = Object.keys(secrets).length > 0;
  if (!hasSecrets) return;

  await saveSecrets(dockerAppConfigPath, secrets);
  success(`Saved your tokens and keys in ${join(paths.configDir, "secrets.yaml")}`);
}

async function writeDevConfig(
  config: AppConfig,
  secrets: SecretsConfig,
  appConfigPath: string,
): Promise<void> {
  await saveAppConfigWithComments(config, appConfigPath);
  success(`Saved your settings in ${appConfigPath}`);

  const hasSecrets = Object.keys(secrets).length > 0;
  if (!hasSecrets) return;

  await saveSecrets(appConfigPath, secrets);
  success(`Saved your tokens and keys in ${dirname(appConfigPath)}/secrets.yaml`);
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
      # Legacy compatibility: older configs may use workspace: /app/workspace
      - ${dockerConfigPath}/workspace:/app/workspace
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

  header("Docker");
  console.log("Prefer `docker run`? Here's the command:");
  console.log(`
docker run -d \\
  --name owliabot \\
  --restart unless-stopped \\
  -p 127.0.0.1:${gatewayPort}:8787 \\
  -v ${paths.shellConfigPath}:/home/owliabot/.owliabot \\
  -v ${paths.shellConfigPath}/workspace:/app/workspace \\
${envFlags}
  \${OWLIABOT_IMAGE:-${defaultImage}} \\
  start -c /home/owliabot/.owliabot/app.yaml
`);

  console.log("Using Docker Compose? Run one of these:");
  console.log("  docker compose up -d     # Docker Compose v2");
  console.log("  docker-compose up -d     # Docker Compose v1");

  header("You're ready");

  console.log("Here's what I saved:");
  console.log("  - ~/.owliabot/auth/          (saved sign-in tokens)");
  console.log("  - ~/.owliabot/app.yaml       (settings)");
  console.log("  - ~/.owliabot/secrets.yaml   (private values)");
  console.log("  - ~/.owliabot/workspace/     (workspace, skills, bootstrap)");
  console.log(`  - ${join(paths.outputDir, "docker-compose.yml")}       (Docker Compose file)`);
  console.log("");

  const needsOAuth = useOpenaiCodex;
  console.log("Next, run:");
  console.log("  1. Start the container:");
  console.log("     docker compose up -d");
  console.log("");
  if (needsOAuth) {
    console.log("  2. Finish sign-in (run after the container is started):");
    if (useOpenaiCodex) {
      console.log("     docker exec -it owliabot owliabot auth setup openai-codex");
    }
    console.log("");
    console.log("  3. Follow along:");
  } else {
    console.log("  2. Follow along:");
  }
  console.log("     docker compose logs -f");
  console.log("");

  console.log("Gateway endpoint:");
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
    success("Added BOOTSTRAP.md to help you get started.");
  }
  if (workspaceInit.copiedSkills && workspaceInit.skillsDir) {
    success(`Built-in skills are ready in ${workspaceInit.skillsDir}`);
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
  header("Next steps");
  console.log("You're almost there:");

  if (discordEnabled && !secrets.discord?.token) {
    console.log("  • Add your Discord token later: owliabot token set discord");
  }
  if (telegramEnabled && !secrets.telegram?.token) {
    console.log("  • Add your Telegram token later: owliabot token set telegram");
  }
  if (providers.some((p) => p.apiKey === "env")) {
    console.log("  • If you're using environment variables, set ANTHROPIC_API_KEY or OPENAI_API_KEY");
  }
  if (providers.some((p) => p.apiKey === "oauth" && p.id === "openai-codex")) {
    console.log("  • Finish sign-in: owliabot auth setup openai-codex");
  }

  if (secrets.gateway?.token) {
    console.log(`  • Gateway endpoint: http://localhost:8787 (token: ${secrets.gateway.token.slice(0, 8)}...)`);
  }

  console.log("  • Start OwliaBot: owliabot start");
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
  } catch (err) {
    warn(`I couldn't update policy.yml automatically: ${(err as Error).message}`);
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

    const channels = await getChannelsSetup(rl, dockerMode, secrets, existing, reuseExisting);

    const tz = detectTimezone();
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
      channels.reuseTelegramConfig,
      channels.telegramAllowList,
      channels.telegramGroups,
    );
    const resolvedWriteToolAllowList = deriveWriteToolAllowListFromConfig(config) ?? writeToolAllowList;
    config.timezone = tz;

    header("Saving your settings");
    if (dockerMode) {
      if (!dockerPaths || !dockerCompose) throw new Error("Internal error: missing docker paths/docker setup");

      // Ensure the container's UID/GID can write into bind-mounted dirs BEFORE
      // writing any files. Without this, writeDockerConfigLocalStyle will fail
      // with EACCES when the host directory is owned by a different UID.
      mkdirSync(join(dockerPaths.configDir, "auth"), { recursive: true });
      tryMakeTreeWritableForDocker(dockerPaths.configDir);

      await writeDockerConfigLocalStyle(dockerPaths, config, secrets);

      // Docker mode: initialize a host workspace directory that is bind-mounted into the container.
      // This matches local mode behavior (BOOTSTRAP.md + bundled skills copy).
      await initDevWorkspace(workspacePath, resolvedWriteToolAllowList);

      const dockerEnv = buildDockerEnvLines(config, secrets, tz);

      const composePath = join(dockerPaths.outputDir, "docker-compose.yml");
      writeFileSync(
        composePath,
        buildDockerComposeYaml(dockerPaths.dockerConfigPath, dockerEnv, dockerCompose.gatewayPort, defaultImage),
      );
      success(`Saved docker-compose.yml in ${composePath}`);

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

  } catch (err) {
    if (err instanceof AbortError) {
      const cmd = dockerMode ? "owliabot onboard --docker" : "owliabot onboard";
      console.log("");
      info("Setup cancelled. No changes were made.");
      console.log(`  You can run this again anytime with: ${COLORS.CYAN}${cmd}${COLORS.NC}`);
      console.log("");
      process.exit(130);
    }
    throw err;
  } finally {
    rl.close();
  }
}
