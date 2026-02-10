/**
 * Unified onboarding for OwliaBot (dev + docker modes)
 *
 * --docker flag switches to Docker-aware mode:
 *   - Generates docker-compose.yml
 *   - Writes configs to ~/.owliabot
 *   - Always configures gateway token + timezone
 *   - Uses default workspace path (/app/workspace) but otherwise follows the
 *     same detailed onboarding prompts (channels allowlists, wallet, write tools security)
 *
 * Without --docker (dev mode):
 *   - Writes to ~/.owlia_dev/ via storage helpers
 *   - Optional gateway, workspace init
 */

import { createInterface } from "node:readline";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { SecretsConfig } from "./secrets.js";
import { success, header } from "./shared.js";

// Re-export all step functions so consumers can import from onboard.ts
export * from "./steps/index.js";

// Import step functions for the orchestrator
import {
  type OnboardOptions,
  type DockerGatewaySetup,
  detectExistingConfig,
  printExistingConfigSummary,
  promptReuseExistingConfig,
  getProvidersSetup,
  getChannelsSetup,
  configureDockerGatewayAndTimezone,
  buildAppConfigFromPrompts,
  deriveWriteToolAllowListFromConfig,
  writeDockerConfigLocalStyle,
  writeDevConfig,
  buildDockerComposeYaml,
  initDevWorkspace,
  getDockerHostWorkspacePath,
  initDockerPaths,
  getConfigAnchorPath,
  printOnboardingBanner,
  printDockerNextSteps,
  printDevNextSteps,
  tryMakeTreeWritableForDocker,
} from "./steps/index.js";

export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const dockerMode = options.docker === true;
  const dockerPaths = dockerMode ? initDockerPaths(options) : null;
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

    const channels = await getChannelsSetup(rl, secrets, existing, reuseExisting);

    let dockerGateway: DockerGatewaySetup | null = null;
    if (dockerMode) {
      dockerGateway = await configureDockerGatewayAndTimezone(rl, existing, reuseExisting, secrets);
    }

    const { config, workspace, writeToolAllowList } = await buildAppConfigFromPrompts(
      rl,
      dockerMode,
      appConfigPath,
      providerResult.providers,
      secrets,
      channels.discordEnabled,
      channels.telegramEnabled,
    );
    const resolvedWriteToolAllowList = deriveWriteToolAllowListFromConfig(config) ?? writeToolAllowList;

    header(dockerMode ? "Writing config" : "Saving configuration");
    if (dockerMode) {
      if (!dockerPaths || !dockerGateway) throw new Error("Internal error: missing docker paths/gateway setup");
      config.timezone = dockerGateway.tz;
      await writeDockerConfigLocalStyle(dockerPaths, config, secrets);

      const hostWorkspacePath = getDockerHostWorkspacePath(dockerPaths);
      await initDevWorkspace(hostWorkspacePath, resolvedWriteToolAllowList);
      mkdirSync(join(dockerPaths.configDir, "auth"), { recursive: true });
      tryMakeTreeWritableForDocker(dockerPaths.configDir);

      const composePath = join(dockerPaths.outputDir, "docker-compose.yml");
      writeFileSync(
        composePath,
        buildDockerComposeYaml(dockerPaths.dockerConfigPath, dockerGateway.tz, dockerGateway.gatewayPort, defaultImage),
      );
      success(`Wrote ${composePath}`);

      printDockerNextSteps(
        dockerPaths,
        dockerGateway.gatewayPort,
        dockerGateway.gatewayToken,
        dockerGateway.tz,
        defaultImage,
        providerResult.useAnthropic,
        providerResult.useOpenaiCodex,
        secrets,
      );
    } else {
      await writeDevConfig(config, secrets, appConfigPath);
      await printDevNextSteps(
        workspace,
        channels.discordEnabled,
        channels.telegramEnabled,
        secrets,
        providerResult.providers,
        resolvedWriteToolAllowList,
      );
    }

    success("All set!");

  } finally {
    rl.close();
  }
}
