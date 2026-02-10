/**
 * Workspace initialization and next steps
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { ensureWorkspaceInitialized } from "../../workspace/init.js";
import type { SecretsConfig } from "../secrets.js";
import type { ProviderConfig } from "../types.js";
import { header, info, success, warn } from "../shared.js";

/**
 * Update workspace policy.yml with allowed user IDs.
 */
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
      // Merge to avoid clobbering manual edits.
      const merged = [...new Set([...current, ...allowedUserIds])];
      defaults.allowedUsers = merged;
    } else if (current === "assignee-only" || current == null) {
      defaults.allowedUsers = allowedUserIds;
    } else {
      // Unknown type; leave as-is.
      return;
    }

    doc.defaults = defaults;
    writeFileSync(policyPath, yamlStringify(doc, { indent: 2 }), "utf-8");
  } catch (err) {
    warn(`I couldn't update policy.yml automatically: ${(err as Error).message}`);
  }
}

/**
 * Initialize workspace for dev mode.
 */
export async function initDevWorkspace(
  workspace: string,
  writeToolAllowList: string[] | null,
): Promise<void> {
  const workspaceInit = await ensureWorkspaceInitialized({ workspacePath: workspace });
  maybeUpdateWorkspacePolicyAllowedUsers(workspace, writeToolAllowList);
  if (workspaceInit.wroteBootstrap) {
    success("Added BOOTSTRAP.md to help you get started.");
  }
  if (workspaceInit.copiedSkills && workspaceInit.skillsDir) {
    success(`Built-in skills are ready in ${workspaceInit.skillsDir}`);
  }
}

/**
 * Print next steps for dev mode.
 */
export function printDevNextStepsText(
  discordEnabled: boolean,
  telegramEnabled: boolean,
  secrets: SecretsConfig,
  providers: ProviderConfig[],
): void {
  header("Next steps");
  console.log("You're almost there:");

  if (discordEnabled && !secrets.discord?.token) {
    console.log("  • Add your Discord token later: owliabot token set discord");
  }
  if (telegramEnabled && !secrets.telegram?.token) {
    console.log("  • Add your Telegram token later: owliabot token set telegram");
  }
  if (providers.some((p) => p.apiKey === "env")) {
    console.log("  • If you're using environment variables, set ANTHROPIC_API_KEY or OPENAI_API_KEY");
  }
  if (providers.some((p) => p.apiKey === "oauth" && p.id === "openai-codex")) {
    console.log("  • Finish sign-in: owliabot auth setup openai-codex");
  }

  if (secrets.gateway?.token) {
    console.log(`  • Gateway endpoint: http://localhost:8787 (token: ${secrets.gateway.token.slice(0, 8)}...)`);
  }

  console.log("  • Start OwliaBot: owliabot start");
  console.log("");
}

/**
 * Print next steps for dev mode (with workspace init).
 */
export async function printDevNextSteps(
  workspacePath: string,
  discordEnabled: boolean,
  telegramEnabled: boolean,
  secrets: SecretsConfig,
  providers: ProviderConfig[],
  writeToolAllowList: string[] | null,
): Promise<void> {
  await initDevWorkspace(workspacePath, writeToolAllowList);
  printDevNextStepsText(discordEnabled, telegramEnabled, secrets, providers);
}
