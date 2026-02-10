/**
 * Unified onboarding for OwliaBot (dev + docker modes)
 *
 * --docker flag switches to Docker-aware mode:
 *   - Generates docker-compose.yml
 *   - Writes config + secrets under OWLIABOT_HOME (~/.owliabot by default)
 *   - Prompts for a host port to expose Gateway HTTP
 *   - Applies bind-mount permission widening for Docker Desktop environments
 *
 * Without --docker:
 *   - Writes config + secrets under OWLIABOT_HOME (or ~/.owlia_dev when OWLIABOT_DEV=1)
 */

import { createInterface } from "node:readline";
import { join } from "node:path";
import { DEFAULT_APP_CONFIG_PATH } from "./storage.js";
import { AbortError, COLORS, info, success, header } from "./shared.js";
import { detectTimezone } from "./steps/helpers.js";
import { getProvidersSetup } from "./steps/provider-setup.js";
import { getChannelsSetup } from "./steps/channel-setup.js";
import { buildAppConfigFromPrompts, deriveWriteToolAllowListFromConfig } from "./steps/config-building.js";
import { detectExistingConfig } from "./steps/config-detection.js";
import {
  initDockerPaths,
  promptDockerComposeSetup,
  buildDockerEnvLines,
  writeDockerCompose,
  printDockerNextSteps,
} from "./steps/docker.js";
import { writeDockerConfigLocalStyle, writeDevConfig, prepareDockerWorkspace } from "./steps/writers.js";
import { printDevNextSteps } from "./steps/workspace-setup.js";
import { initDevWorkspace } from "./steps/init-dev-workspace.js";
import {
  printOnboardingBanner,
  printExistingConfigSummary,
  promptReuseExistingConfig,
  ensureGatewayToken,
} from "./steps/ui.js";
import type { SecretsConfig } from "./secrets.js";

// Re-export all step functions so consumers can import from onboard.ts
export * from "./steps/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardOptions {
  /** Path for app.yaml in dev mode */
  appConfigPath?: string;
  /** Enable Docker-aware mode */
  docker?: boolean;
  /** Output directory for docker-compose.yml (docker mode) */
  outputDir?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path resolution
// ─────────────────────────────────────────────────────────────────────────────

function getConfigAnchorPath(
  options: OnboardOptions,
  dockerMode: boolean,
  dockerPaths: ReturnType<typeof initDockerPaths> | null,
): string {
  if (dockerMode) {
    if (!dockerPaths) throw new Error("Internal error: dockerPaths is required in docker mode");
    return join(dockerPaths.configDir, "app.yaml");
  }
  return options.appConfigPath ?? DEFAULT_APP_CONFIG_PATH;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main onboarding flow
// ─────────────────────────────────────────────────────────────────────────────

export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const dockerMode = options.docker === true;
  const dockerPaths = dockerMode ? initDockerPaths(options.outputDir) : null;
  const appConfigPath = getConfigAnchorPath(options, dockerMode, dockerPaths);
  const defaultImage = "ghcr.io/owliabot/owliabot:latest";

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    printOnboardingBanner(dockerMode);

    const existing = await detectExistingConfig(dockerMode, appConfigPath);
    if (existing) printExistingConfigSummary(dockerMode, appConfigPath, existing);
    const reuseExisting = await promptReuseExistingConfig(rl, existing);

    const providerResult = await getProvidersSetup(rl, dockerMode, existing, reuseExisting);
    const secrets: SecretsConfig = { ...providerResult.secrets };

    const channels = await getChannelsSetup(rl, dockerMode, secrets, existing, reuseExisting);

    const tz = detectTimezone();
    const gatewayToken = ensureGatewayToken(secrets, existing, reuseExisting);

    let dockerCompose: Awaited<ReturnType<typeof promptDockerComposeSetup>> | null = null;
    if (dockerMode) {
      dockerCompose = await promptDockerComposeSetup(rl, gatewayToken);
    }

    const { config, workspacePath, writeToolAllowList } = await buildAppConfigFromPrompts(
      rl,
      dockerMode,
      appConfigPath,
      providerResult.providers,
      secrets,
      channels.discordEnabled,
      channels.telegramEnabled,
      channels.reuseTelegramConfig ?? false,
      channels.telegramAllowList,
      channels.telegramGroups,
    );
    const resolvedWriteToolAllowList = deriveWriteToolAllowListFromConfig(config) ?? writeToolAllowList;
    config.timezone = tz;

    header("Saving your settings");
    if (dockerMode) {
      if (!dockerPaths || !dockerCompose) throw new Error("Internal error: missing docker paths/docker setup");

      prepareDockerWorkspace(dockerPaths);
      await writeDockerConfigLocalStyle(dockerPaths, config, secrets);

      // Docker mode: initialize a host workspace directory that is bind-mounted into the container.
      await initDevWorkspace(workspacePath, resolvedWriteToolAllowList);

      const dockerEnv = buildDockerEnvLines(config, secrets, tz);
      writeDockerCompose(dockerPaths, dockerPaths.dockerConfigPath, dockerEnv, dockerCompose.gatewayPort, defaultImage);

      printDockerNextSteps(
        dockerPaths,
        dockerCompose.gatewayPort,
        gatewayToken,
        tz,
        dockerEnv,
        defaultImage,
        providerResult.useAnthropic,
        providerResult.useOpenaiCodex,
        secrets,
      );
    } else {
      await writeDevConfig(config, secrets, appConfigPath);
      await printDevNextSteps(
        workspacePath,
        channels.discordEnabled,
        channels.telegramEnabled,
        secrets,
        providerResult.providers,
        resolvedWriteToolAllowList,
      );
    }

    success("All set!");

  } catch (err) {
    if (err instanceof AbortError) {
      const cmd = dockerMode ? "owliabot onboard --docker" : "owliabot onboard";
      console.log("");
      info("Setup cancelled. No changes were made.");
      console.log(`  You can run this again anytime with: ${COLORS.CYAN}${cmd}${COLORS.NC}`);
      console.log("");
      process.exit(130);
    }
    throw err;
  } finally {
    rl.close();
  }
}
