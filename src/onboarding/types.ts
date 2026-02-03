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
  };

  // Providers
  providers: Array<
    | {
        id: "anthropic";
        model: string;
        apiKey: "oauth"; // onboarding supports oauth placeholder
        priority: number;
      }
    | {
        id: string;
        model: string;
        apiKey: string;
        priority: number;
      }
  >;

  notifications?: {
    channel: string;
  };
}
