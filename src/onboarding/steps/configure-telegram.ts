/**
 * Step module: Telegram configuration.
 */

import { createInterface } from "node:readline";
import type { AppConfig } from "../types.js";
import { success, header, ask } from "../shared.js";
import type { UserAllowLists } from "./types.js";

export async function configureTelegramConfig(
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
