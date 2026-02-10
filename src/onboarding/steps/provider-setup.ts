/**
 * Provider setup for onboarding (AI provider configuration)
 */

import { createInterface } from "node:readline";
import type { ProviderConfig, LLMProviderId } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { startOAuthFlow } from "../../auth/oauth.js";
import { validateAnthropicSetupToken, isSetupToken } from "../../auth/setup-token.js";
import { listConfiguredModelCatalog } from "../../models/catalog.js";
import {
  ask,
  askYN,
  selectOption,
  info,
  success,
  warn,
  header,
  DEFAULT_MODELS,
} from "../shared.js";
import type { DetectedConfig, ProviderResult, ProviderSetupState } from "./types.js";

type RL = ReturnType<typeof createInterface>;

/**
 * Prompt for which model to use for a given provider.
 * Uses the model catalog when available, falls back to free-text input.
 */
export async function promptModel(
  rl: RL,
  providerId: string,
  defaultModel: string,
): Promise<string> {
  const providerKey = providerId.trim().toLowerCase();
  const entries = listConfiguredModelCatalog({
    // Seed with the provider we are configuring so pi-ai backed providers list their full catalog.
    providers: [{ id: providerKey, model: defaultModel }],
  });
  const catalogModels = entries
    .filter((e) => e.provider === providerKey)
    .map((e) => e.model)
    .filter(Boolean);

  const seen = new Set<string>();
  const uniqueCatalogModels: string[] = [];
  for (const m of catalogModels) {
    if (seen.has(m)) continue;
    seen.add(m);
    uniqueCatalogModels.push(m);
  }

  // If the catalog is empty/unavailable, keep prior behavior (free text with default).
  if (uniqueCatalogModels.length === 0) {
    return (await ask(rl, `Which model should I use? [${defaultModel}]: `)) || defaultModel;
  }

  // Keep default model first if it exists in the catalog; otherwise just use catalog order.
  const orderedModels = uniqueCatalogModels.includes(defaultModel)
    ? [defaultModel, ...uniqueCatalogModels.filter((m) => m !== defaultModel)]
    : uniqueCatalogModels;

  const CUSTOM = "Custom (type your own)";
  const picked = await selectOption(rl, "Which model should I use?", [
    ...orderedModels,
    CUSTOM,
  ]);

  if (picked === orderedModels.length) {
    return (await ask(rl, `Which model should I use? [${defaultModel}]: `)) || defaultModel;
  }
  return orderedModels[picked] ?? defaultModel;
}

/**
 * Configure Anthropic provider if selected.
 */
export async function maybeConfigureAnthropic(
  rl: RL,
  state: ProviderSetupState,
  aiChoice: number,
  existing?: DetectedConfig | null,
): Promise<void> {
  if (!(aiChoice === 0 || aiChoice === 4)) return;

  state.useAnthropic = true;
  console.log("");

  header("Connect Claude (Anthropic)");
  const existingToken = existing?.anthropicToken;
  const existingTokenValid = existing?.anthropicTokenValid;
  const canReuseToken = !!existingToken && existingTokenValid !== false;

  // If we already have a valid setup-token, don't force the user through auth again.
  if (canReuseToken) {
    state.secrets.anthropic = { ...(state.secrets.anthropic ?? {}), token: existingToken };
    success("Detected an existing Claude setup-token. Skipping authorization.");
  } else {
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
  }

  const defaultModel = DEFAULT_MODELS.anthropic;
  const model = await promptModel(rl, "anthropic", defaultModel);
  const apiKeyValue = state.secrets.anthropic ? "secrets" : "env";

  state.providers.push({
    id: "anthropic",
    model,
    apiKey: apiKeyValue,
    priority: state.priority++,
  } as ProviderConfig);
}

/**
 * Configure OpenAI provider if selected.
 */
export async function maybeConfigureOpenAI(
  rl: RL,
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
  const model = await promptModel(rl, "openai", defaultModel);
  state.providers.push({
    id: "openai",
    model,
    apiKey: apiKey ? "secrets" : "env",
    priority: state.priority++,
  } as ProviderConfig);
}

/**
 * Configure OpenAI Codex provider if selected.
 */
export async function maybeConfigureOpenAICodex(
  rl: RL,
  dockerMode: boolean,
  state: ProviderSetupState,
  aiChoice: number,
  existing?: DetectedConfig | null,
): Promise<void> {
  if (!(aiChoice === 2 || aiChoice === 4)) return;

  state.useOpenaiCodex = true;
  console.log("");
  info("If you have ChatGPT Plus/Pro, you can connect via OAuth (no API key needed).");

  const hasExistingOAuth = existing?.hasOAuthCodex === true;
  if (hasExistingOAuth) {
    success("Detected an existing OpenAI Codex OAuth token. Skipping authorization.");
  } else {
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
  }

  state.providers.push({
    id: "openai-codex",
    model: DEFAULT_MODELS["openai-codex"],
    apiKey: "oauth",
    priority: state.priority++,
  } as ProviderConfig);
}

/**
 * Configure OpenAI-compatible provider if selected.
 */
export async function maybeConfigureOpenAICompatible(
  rl: RL,
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
  const model = await promptModel(rl, "openai-compatible", defaultModel);
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

/**
 * Interactive prompt for AI providers.
 */
export async function askProviders(
  rl: RL,
  dockerMode: boolean,
  existing?: DetectedConfig | null,
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

  await maybeConfigureAnthropic(rl, state, aiChoice, existing);
  await maybeConfigureOpenAI(rl, state, aiChoice);
  await maybeConfigureOpenAICodex(rl, dockerMode, state, aiChoice, existing);
  await maybeConfigureOpenAICompatible(rl, state, aiChoice);

  return {
    providers: state.providers,
    secrets: state.secrets,
    useAnthropic: state.useAnthropic,
    useOpenaiCodex: state.useOpenaiCodex,
  };
}

/**
 * Reuse existing provider configuration.
 */
export function reuseProvidersFromExisting(existing: DetectedConfig): ProviderResult {
  const secrets: SecretsConfig = {};
  const providers: ProviderConfig[] = [];
  let priority = 1;
  let useAnthropic = false;
  let useOpenaiCodex = false;

  // Anthropic
  if (existing.anthropicKey || existing.anthropicToken) {
    useAnthropic = true;
    if (existing.anthropicKey) secrets.anthropic = { apiKey: existing.anthropicKey };
    if (existing.anthropicToken) secrets.anthropic = { ...secrets.anthropic, token: existing.anthropicToken };
    providers.push({
      id: "anthropic",
      model: DEFAULT_MODELS.anthropic,
      apiKey: "secrets",
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
  if (existing.hasOAuthCodex) {
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

/**
 * Get provider setup - either reuse existing or prompt for new.
 */
export async function getProvidersSetup(
  rl: RL,
  dockerMode: boolean,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
): Promise<ProviderResult> {
  header("AI");

  if (reuseExisting && existing) {
    const reused = reuseProvidersFromExisting(existing);
    if (reused.providers.length > 0) return reused;
  }

  const result = await askProviders(rl, dockerMode, existing);
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
