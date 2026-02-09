/**
 * Config merge utilities - atomic YAML patching
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { randomBytes } from "node:crypto";
import { createLogger } from "../utils/logger.js";

const log = createLogger("config-merge");

export interface DiscordConfigPatch {
  requireMentionInGuild?: boolean;
  channelAllowList?: string[];
  memberAllowList?: string[];
  adminUsers?: string[];
  guilds?: Record<string, {
    channelAllowList?: string[];
    memberAllowList?: string[];
    requireMentionInGuild?: boolean;
    adminUsers?: string[];
  }>;
}

/**
 * Merge Discord config patch into app.yaml
 * Atomic write: write to temp file, then rename
 */
export async function mergeDiscordConfig(
  appConfigPath: string,
  discordPatch: DiscordConfigPatch
): Promise<void> {
  try {
    // Read existing config
    const raw = await readFile(appConfigPath, "utf-8");
    const doc = (parse(raw) as any) ?? {};

    // Merge discord section
    doc.discord = {
      ...(doc.discord || {}),
      ...discordPatch,
    };

    // Write to temp file
    const tmpPath = `${appConfigPath}.tmp.${randomBytes(4).toString("hex")}`;
    await writeFile(tmpPath, stringify(doc, { lineWidth: 120 }), "utf-8");

    // Atomic rename
    await rename(tmpPath, appConfigPath);

    log.info(`Merged Discord config to ${appConfigPath}`);
  } catch (err) {
    log.error("Failed to merge Discord config", err);
    throw err;
  }
}
