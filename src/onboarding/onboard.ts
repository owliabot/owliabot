import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";
import type { AppConfig } from "./types.js";
import { saveAppConfig, DEV_APP_CONFIG_PATH } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, type SecretsConfig } from "./secrets.js";

const log = createLogger("onboard");

function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
}

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

    // Provider: Anthropic OAuth for now
    const model =
      (await ask(rl, "Anthropic model [claude-sonnet-4-5]: ")) ||
      "claude-sonnet-4-5";

    const useOauthAns =
      (await ask(rl, "Use Anthropic OAuth? (y/n) [y]: ")) || "y";
    const useOauth = useOauthAns.toLowerCase().startsWith("y");

    if (!useOauth) {
      log.warn(
        "This onboarding MVP currently assumes OAuth; API key mode is still available by editing config.yaml."
      );
    }

    if (useOauth) {
      log.info("Starting Anthropic OAuth flow...");
      await startOAuthFlow();
    }

    const config: AppConfig = {
      workspace,
      providers: [
        {
          id: "anthropic",
          model,
          apiKey: "oauth",
          priority: 1,
        },
      ],
    };

    const secrets: SecretsConfig = {};

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

      // Only write telegram section if token exists; otherwise omit to keep config valid.
      if (telegramToken) {
        config.telegram = {};
      }
    }

    // Save app config (non-sensitive)
    await saveAppConfig(config, appConfigPath);

    // Save secrets (sensitive)
    if (secrets.discord?.token || secrets.telegram?.token) {
      await saveSecrets(appConfigPath, secrets);
    }

    log.info(`Saved app config to: ${appConfigPath}`);
    log.info("Next steps:");
    log.info("1) If you skipped tokens, set them now via:");
    log.info("   - owliabot token set discord   (reads DISCORD_BOT_TOKEN env)");
    log.info("   - owliabot token set telegram  (reads TELEGRAM_BOT_TOKEN env)");
    log.info("2) Start the bot: owliabot start");
  } finally {
    rl.close();
  }
}
