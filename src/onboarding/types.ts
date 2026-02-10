/** Supported LLM provider identifiers */
export type LLMProviderId = "anthropic" | "openai" | "openai-codex" | "openai-compatible";

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

/** Memory search configuration */
export interface MemorySearchConfig {
  enabled: boolean;
  provider: "sqlite" | "naive";
  fallback: "sqlite" | "naive" | "none";
  store: {
    path: string;
  };
  extraPaths: string[];
  sources: Array<"files" | "transcripts">;
  indexing: {
    autoIndex: boolean;
    minIntervalMs: number;
  };
}

/** System capability configuration */
export interface SystemCapabilityConfig {
  exec: {
    commandAllowList: string[];
    envAllowList: string[];
    timeoutMs: number;
    maxOutputBytes: number;
  };
  web: {
    domainAllowList: string[];
    domainDenyList: string[];
    allowPrivateNetworks: boolean;
    timeoutMs: number;
    maxResponseBytes: number;
    blockOnSecret: boolean;
  };
  webSearch: {
    defaultProvider: "brave" | "duckduckgo";
    timeoutMs: number;
    maxResults: number;
  };
}

export interface AppConfig {
  // Workspace path (can be relative to the config file location)
  workspace: string;

  // Timezone (used in prompts)
  timezone?: string;

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
    /** Optional allowlist for direct messages */
    allowList?: string[];
    /**
     * Per-group overrides (by Telegram chat id), plus optional "*" default.
     * Example: telegram.groups["-100123"].requireMention = false
     */
    groups?: Record<
      string,
      {
        enabled?: boolean;
        requireMention?: boolean;
        allowFrom?: string[];
        historyLimit?: number;
      }
    >;
  };

  // Providers
  providers: ProviderConfig[];

  notifications?: {
    channel: string;
  };

  // Memory search
  memorySearch?: MemorySearchConfig;

  // System capabilities (exec / web.fetch / web.search)
  system?: SystemCapabilityConfig;

  // Gateway HTTP configuration
  gateway?: {
    http?: {
      host: string;
      port: number;
      token?: string;
      allowlist?: string[];
    };
  };

  // Security configuration
  security?: {
    /** Global write-gate switch (default: true) */
    writeGateEnabled?: boolean;
    /** User IDs allowed to trigger write-level tools */
    writeToolAllowList?: string[];
    /** Whether to require interactive confirmation for write tools (default: true) */
    writeToolConfirmation?: boolean;
    /** Timeout in ms for write tool confirmation */
    writeToolConfirmationTimeoutMs?: number;
  };

  // Tool configuration
  tools?: {
    /** Enable filesystem write tools (write_file / edit_file / apply_patch) */
    allowWrite?: boolean;
  };

  // Wallet configuration (Clawlet integration)
  wallet?: {
    clawlet?: {
      enabled?: boolean;
      baseUrl?: string;
      requestTimeout?: number;
      defaultChainId?: number;
      defaultAddress?: string;
    };
  };
}
