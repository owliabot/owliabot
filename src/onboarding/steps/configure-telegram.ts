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
  header("Telegram");

  const telegramUserIds = await ask(
    rl,
    "Who can talk to OwliaBot? (comma-separated user IDs, leave empty for anyone): ",
  );
  const allowList = telegramUserIds.split(",").map((s) => s.trim()).filter(Boolean);
  userAllowLists.telegram = allowList;

  config.telegram = {
    ...(allowList.length > 0 && { allowList }),
  };

  if (allowList.length > 0) {
    success(`Allowed Telegram users: ${allowList.join(", ")}`);
  }
}
