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

  header("Write tools security");
  info("Users in the write-tool allowlist can use file write/edit tools.");
  info(`Auto-included from channel allowlists: ${allUserIds.join(", ")}`);

  const writeAllowListAns = await ask(
    rl,
    "Additional user IDs to allow (comma-separated, leave empty to use only channel users): ",
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

  success("Filesystem write tools enabled (write_file/edit_file/apply_patch)");
  success(`Write-tool allowlist: ${writeToolAllowList.join(", ")}`);
  success("Write-gate globally disabled");
  success("Write-tool confirmation disabled (allowlisted users can write directly)");
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
