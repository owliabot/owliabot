/**
 * Workspace initialization and next steps
 */

import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import type { SecretsConfig } from "../secrets.js";
import type { ProviderConfig } from "../types.js";
import { header, info, success, ask } from "../shared.js";
import { initDevWorkspace } from "./init-dev-workspace.js";

/**
 * Get workspace path from user or defaults.
 */
export async function getWorkspacePath(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
): Promise<string> {
  header("Workspace");

  if (dockerMode) {
    const workspace = "/app/workspace";
    info("Docker mode uses the default workspace path inside the container.");
    success(`Workspace: ${workspace}`);
    return workspace;
  }

  const defaultWorkspace = join(dirname(appConfigPath), "workspace");
  const workspace = (await ask(rl, `Workspace path [${defaultWorkspace}]: `)) || defaultWorkspace;
  success(`Workspace: ${workspace}`);
  return workspace;
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
