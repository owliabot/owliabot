/**
 * Step module: utility/helper functions.
 */

import { join } from "node:path";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ProviderConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { IS_DEV_MODE } from "../storage.js";
import { info, success, header, printBanner } from "../shared.js";
import type { DockerPaths, OnboardOptions } from "./types.js";
import { DEFAULT_APP_CONFIG_PATH } from "../storage.js";
import { initDevWorkspace } from "./init-dev-workspace.js";

export function getDockerHostWorkspacePath(paths: DockerPaths): string {
  return join(paths.configDir, "workspace");
}

export function getDockerComposeWorkspaceMount(paths: DockerPaths): string {
  return `${paths.dockerConfigPath}/workspace:/app/workspace`;
}

export function getDockerRunWorkspaceMount(paths: DockerPaths): string {
  return `${paths.shellConfigPath}/workspace:/app/workspace`;
}

export function getConfigAnchorPath(
  options: OnboardOptions,
  dockerMode: boolean,
  dockerPaths: DockerPaths | null,
): string {
  if (dockerMode) {
    if (!dockerPaths) throw new Error("Internal error: dockerPaths is required in docker mode");
    return join(dockerPaths.configDir, "app.yaml");
  }
  return options.appConfigPath ?? DEFAULT_APP_CONFIG_PATH;
}

export function initDockerPaths(options: OnboardOptions): DockerPaths {
  const hostConfigDirAbs = join(homedir(), ".owliabot");
  const dockerConfigPath = "~/.owliabot";
  const shellConfigPath = "~/.owliabot";
  const outputDir = options.outputDir ?? ".";

  mkdirSync(hostConfigDirAbs, { recursive: true });

  return {
    configDir: hostConfigDirAbs,
    containerConfigDir: options.configDir ?? "/app/config",
    dockerConfigPath,
    shellConfigPath,
    outputDir,
  };
}

export function printOnboardingBanner(dockerMode: boolean): void {
  if (dockerMode) {
    printBanner("(Docker)");
    return;
  }

  printBanner(IS_DEV_MODE ? "(dev mode)" : "");
  if (IS_DEV_MODE) {
    info("Dev mode enabled (OWLIABOT_DEV=1). Config will be saved to ~/.owlia_dev/");
  }
}

export function printDockerNextSteps(
  paths: DockerPaths,
  gatewayPort: string,
  gatewayToken: string,
  tz: string,
  defaultImage: string,
  useAnthropic: boolean,
  useOpenaiCodex: boolean,
  secrets: SecretsConfig,
): void {
  header("Docker commands");
  console.log("Docker run command:");
  console.log(`
docker run -d \\
  --name owliabot \\
  --restart unless-stopped \\
  -p 127.0.0.1:${gatewayPort}:8787 \\
  -v ${paths.shellConfigPath}:/home/owliabot/.owliabot \\
  -v ${getDockerRunWorkspaceMount(paths)} \\
  -e TZ=${tz} \\
  \${OWLIABOT_IMAGE:-${defaultImage}} \\
  start -c /home/owliabot/.owliabot/app.yaml
`);

  console.log("To start:");
  console.log("  docker compose up -d     # Docker Compose v2");
  console.log("  docker-compose up -d     # Docker Compose v1");

  header("Done");

  console.log("Files created:");
  console.log("  - ~/.owliabot/auth/          (OAuth tokens)");
  console.log("  - ~/.owliabot/app.yaml       (app config)");
  console.log("  - ~/.owliabot/secrets.yaml   (sensitive)");
  console.log("  - ~/.owliabot/workspace/     (workspace, skills, bootstrap)");
  console.log(`  - ${join(paths.outputDir, "docker-compose.yml")}       (Docker Compose)`);
  console.log("");

  const needsOAuth = (useAnthropic && !secrets.anthropic?.apiKey) || useOpenaiCodex;
  console.log("Next steps:");
  console.log("  1. Start the container:");
  console.log("     docker compose up -d");
  console.log("");
  if (needsOAuth) {
    console.log("  2. Set up OAuth authentication (run after container is started):");
    if (useAnthropic && !secrets.anthropic?.apiKey) {
      console.log("     docker exec -it owliabot owliabot auth setup anthropic");
    }
    if (useOpenaiCodex) {
      console.log("     docker exec -it owliabot owliabot auth setup openai-codex");
    }
    console.log("");
    console.log("  3. Watch container output:");
  } else {
    console.log("  2. Watch container output:");
  }
  console.log("     docker compose logs -f");
  console.log("");

  console.log("Gateway HTTP:");
  console.log(`  - URL:   http://localhost:${gatewayPort}`);
  console.log(`  - Token: ${gatewayToken.slice(0, 8)}...`);
  console.log("");
}

export function tryMakeTreeWritableForDocker(rootPath: string): void {
  if (process.platform === "win32") return;

  const stack: string[] = [rootPath];
  while (stack.length > 0) {
    const p = stack.pop();
    if (!p) break;

    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }

    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      try { chmodSync(p, 0o777); } catch { /* best-effort */ }
      let entries;
      try { entries = readdirSync(p, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        stack.push(join(p, ent.name));
      }
      continue;
    }

    if (st.isFile()) {
      try { chmodSync(p, 0o666); } catch { /* best-effort */ }
    }
  }
}

export function printDevNextStepsText(
  discordEnabled: boolean,
  telegramEnabled: boolean,
  secrets: SecretsConfig,
  providers: ProviderConfig[],
): void {
  header("Done!");
  console.log("Next steps:");

  if (discordEnabled && !secrets.discord?.token) {
    console.log("  • Set Discord token: owliabot token set discord");
  }
  if (telegramEnabled && !secrets.telegram?.token) {
    console.log("  • Set Telegram token: owliabot token set telegram");
  }
  if (providers.some((p) => p.apiKey === "env")) {
    console.log("  • Set API key env var (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
  }
  if (providers.some((p) => p.apiKey === "oauth" && p.id === "openai-codex")) {
    console.log("  • Complete OAuth: owliabot auth setup openai-codex");
  }

  console.log("  • Start the bot: owliabot start");
  console.log("");
}

export async function printDevNextSteps(
  workspace: string,
  discordEnabled: boolean,
  telegramEnabled: boolean,
  secrets: SecretsConfig,
  providers: ProviderConfig[],
  writeToolAllowList: string[] | null,
): Promise<void> {
  await initDevWorkspace(workspace, writeToolAllowList);
  printDevNextStepsText(discordEnabled, telegramEnabled, secrets, providers);
}
