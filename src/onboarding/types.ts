/** Supported LLM provider identifiers */
export type LLMProviderId = "anthropic" | "openai" | "openai-codex";

/** Provider configuration with OAuth or API key auth */
export type ProviderConfig =
  | {
      id: "anthropic";
      model: string;
      apiKey: "oauth"; // Anthropic OAuth (Claude Pro/Max subscription)
      priority: number;
    }
  | {
      id: "openai-codex";
      model: string;
      apiKey: "oauth"; // OpenAI Codex OAuth (ChatGPT Plus/Pro subscription)
      priority: number;
    }
  | {
      id: "openai";
      model: string;
      apiKey: string; // OpenAI API key (from secrets or env)
      priority: number;
    }
  | {
      id: "anthropic";
      model: string;
      apiKey: string; // Anthropic API key (from secrets or env)
      priority: number;
    }
  | {
      id: string;
      model: string;
      apiKey: string;
      priority: number;
    };

export interface AppConfig {
  // Workspace path (can be relative to the config file location)
  workspace: string;

  // Channels
  discord?: {
    /** Discord bot token is expected via onboarding secrets.yaml or env */
    requireMentionInGuild?: boolean;
    channelAllowList?: string[];
    /** Optional allowlist for user ids (DMs / guild) */
    memberAllowList?: string[];
  };

  telegram?: {
    /** Telegram bot token is expected via env (TELEGRAM_BOT_TOKEN) */
    allowList?: string[];
    groupAllowList?: string[];
  };

  // Providers
  providers: ProviderConfig[];

  notifications?: {
    channel: string;
  };
}
