/**
 * Step module: provider setup (Anthropic, OpenAI, OpenAI Codex, OpenAI-compatible).
 */

import { createInterface } from "node:readline";
import type { ProviderConfig, LLMProviderId } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { info, success, warn, header, ask, askYN, selectOption, DEFAULT_MODELS } from "../shared.js";
import { startOAuthFlow } from "../../auth/oauth.js";
import { validateAnthropicSetupToken, isSetupToken } from "../../auth/setup-token.js";
import type { DetectedConfig, ProviderResult, ProviderSetupState } from "./types.js";

export async function maybeConfigureAnthropic(
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

export async function maybeConfigureOpenAI(
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

export async function maybeConfigureOpenAICodex(
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

export async function maybeConfigureOpenAICompatible(
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

export async function askProviders(
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

export function reuseProvidersFromExisting(existing: DetectedConfig): ProviderResult {
  const secrets: SecretsConfig = {};
  const providers: ProviderConfig[] = [];
  let priority = 1;
  let useAnthropic = false;
  let useOpenaiCodex = false;

  // Anthropic
  if (existing.anthropicKey || existing.anthropicToken || existing.hasOAuthAnthro) {
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
  if (existing.hasOAuthCodex) {
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

export async function getProvidersSetup(
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
