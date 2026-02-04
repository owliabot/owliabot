/**
 * Model resolution and aliases
 * @see design.md Section 5.5
 */

import { getModel, getModels, type Model, type Api, type KnownProvider } from "@mariozechner/pi-ai";
import { createLogger } from "../utils/logger.js";

const log = createLogger("models");

export interface ModelConfig {
  provider?: string;
  model: string;
  /** API key from config (loaded from secrets.yaml or env) */
  apiKey?: string;
}

// Model aliases for convenience
const MODEL_ALIASES: Record<string, { provider: KnownProvider; model: string }> = {
  // Anthropic aliases
  "sonnet": { provider: "anthropic", model: "claude-sonnet-4-5" },
  "opus": { provider: "anthropic", model: "claude-opus-4-5" },
  "haiku": { provider: "anthropic", model: "claude-3-5-haiku" },
  "claude-sonnet-4-5": { provider: "anthropic", model: "claude-sonnet-4-5" },
  "claude-opus-4-5": { provider: "anthropic", model: "claude-opus-4-5" },
  "claude-3-5-sonnet": { provider: "anthropic", model: "claude-3-5-sonnet" },
  "claude-3-5-haiku": { provider: "anthropic", model: "claude-3-5-haiku" },

  // OpenAI aliases
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
  "o1": { provider: "openai", model: "o1" },
  "o1-mini": { provider: "openai", model: "o1-mini" },

  // Google aliases
  "gemini": { provider: "google", model: "gemini-2.5-pro" },
  "gemini-2.5-pro": { provider: "google", model: "gemini-2.5-pro" },
  "gemini-2.5-flash": { provider: "google", model: "gemini-2.5-flash" },
};

/**
 * Safely get a model from pi-ai with runtime validation
 * Critical fix #2: Add runtime validation for model resolution
 */
function safeGetModel(provider: string, modelId: string): Model<Api> {
  try {
    const model = getModel(provider as KnownProvider, modelId as never);
    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`);
    }
    return model as Model<Api>;
  } catch (err) {
    // If getModel throws, provide a helpful error message
    const availableModels = getAvailableModels(provider);
    const modelList = availableModels.map((m) => m.id).join(", ");
    throw new Error(
      `Unknown model: ${provider}/${modelId}. ` +
        (modelList
          ? `Available models for ${provider}: ${modelList}`
          : `Provider '${provider}' may not be supported.`)
    );
  }
}

/**
 * Resolve a model configuration to a pi-ai Model object
 */
export function resolveModel(config: ModelConfig): Model<Api> {
  // Check aliases first
  const alias = MODEL_ALIASES[config.model];
  if (alias) {
    log.debug(`Resolved alias ${config.model} to ${alias.provider}/${alias.model}`);
    return safeGetModel(alias.provider, alias.model);
  }

  // Handle provider/model format (e.g., "anthropic/claude-sonnet-4-5")
  if (config.model.includes("/")) {
    const [provider, modelId] = config.model.split("/", 2);
    log.debug(`Resolved ${config.model} to ${provider}/${modelId}`);
    return safeGetModel(provider, modelId);
  }

  // Use explicit provider if given
  if (config.provider) {
    log.debug(`Using explicit provider: ${config.provider}/${config.model}`);
    return safeGetModel(config.provider, config.model);
  }

  // Default to Anthropic
  log.debug(`Defaulting to anthropic/${config.model}`);
  return safeGetModel("anthropic", config.model);
}

/**
 * Get all available models for a provider
 */
export function getAvailableModels(provider: string): Model<Api>[] {
  try {
    return getModels(provider as KnownProvider) as Model<Api>[];
  } catch {
    return [];
  }
}

/**
 * Validate all model aliases at startup (optional)
 */
export function validateAliases(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [alias, { provider, model }] of Object.entries(MODEL_ALIASES)) {
    try {
      safeGetModel(provider, model);
    } catch (err) {
      errors.push(`Alias '${alias}' -> ${provider}/${model}: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
