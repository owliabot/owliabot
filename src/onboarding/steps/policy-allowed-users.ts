/**
 * Step module: workspace policy allowed users update.
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { createLogger } from "../../utils/logger.js";
import { warn } from "../shared.js";

const log = createLogger("onboard");

export function maybeUpdateWorkspacePolicyAllowedUsers(
  workspacePath: string,
  allowedUserIds: string[] | null,
): void {
  if (!allowedUserIds || allowedUserIds.length === 0) return;
  const policyPath = join(workspacePath, "policy.yml");
  if (!existsSync(policyPath)) return;

  try {
    const raw = readFileSync(policyPath, "utf-8");
    const doc = (yamlParse(raw) ?? {}) as Record<string, any>;
    const defaults = (doc.defaults ?? {}) as Record<string, any>;
    const current = defaults.allowedUsers as unknown;

    if (Array.isArray(current)) {
      const merged = [...new Set([...current, ...allowedUserIds])];
      defaults.allowedUsers = merged;
    } else if (current === "assignee-only" || current == null) {
      defaults.allowedUsers = allowedUserIds;
    } else {
      return;
    }

    doc.defaults = defaults;
    writeFileSync(policyPath, yamlStringify(doc, { indent: 2 }), "utf-8");
    log.info(`Updated policy allowedUsers in ${policyPath}`);
  } catch (err) {
    warn(`Failed to update policy.yml allowedUsers: ${(err as Error).message}`);
  }
}
