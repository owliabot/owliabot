/**
 * Step module: write tools security configuration.
 */

import { createInterface } from "node:readline";
import type { AppConfig } from "../types.js";
import { info, success, header, ask } from "../shared.js";
import type { UserAllowLists } from "./types.js";

export async function configureWriteToolsSecurity(
  rl: ReturnType<typeof createInterface>,
  config: AppConfig,
  userAllowLists: UserAllowLists,
): Promise<string[] | null> {
  const allUserIds = [...userAllowLists.discord, ...userAllowLists.telegram];
  if (allUserIds.length === 0) return null;

  header("File tools (safety)");
  info("These tools can write/edit files. It's best to keep them limited to specific user IDs.");
  info(`Starting with the people you already allow in chat: ${allUserIds.join(", ")}`);

  const writeAllowListAns = await ask(
    rl,
    "Anyone else should be allowed to use file tools? (comma-separated user IDs, or press Enter): ",
  );
  const additionalIds = writeAllowListAns.split(",").map((s) => s.trim()).filter(Boolean);
  const writeToolAllowList = [...new Set([...allUserIds, ...additionalIds])];
  if (writeToolAllowList.length === 0) return null;

  config.tools = {
    ...(config.tools ?? {}),
    allowWrite: true,
  };
  config.security = {
    writeGateEnabled: false,
    writeToolAllowList,
    writeToolConfirmation: false,
  };

  success(`File tools enabled for: ${writeToolAllowList.join(", ")}`);
  return writeToolAllowList;
}

export function deriveWriteToolAllowListFromConfig(config: AppConfig): string[] | null {
  const sec = (config as any).security as { writeToolAllowList?: unknown } | undefined;
  const fromSecurity = sec?.writeToolAllowList;
  if (Array.isArray(fromSecurity) && fromSecurity.length > 0) {
    return fromSecurity.filter((v) => typeof v === "string" && v.trim().length > 0);
  }

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
