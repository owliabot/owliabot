/**
 * Config file writers for onboarding
 */

import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "../types.js";
import { saveSecrets, type SecretsConfig } from "../secrets.js";
import { saveAppConfig } from "../storage.js";
import { success } from "../shared.js";
import { saveAppConfigWithComments } from "./helpers.js";
import type { DockerPaths } from "./docker.js";
import { tryMakeTreeWritableForDocker } from "./docker.js";

/**
 * Write Docker config files in local style.
 */
export async function writeDockerConfigLocalStyle(
  paths: DockerPaths,
  config: AppConfig,
  secrets: SecretsConfig,
): Promise<void> {
  const dockerAppConfigPath = join(paths.configDir, "app.yaml");
  await saveAppConfigWithComments(config, dockerAppConfigPath, saveAppConfig);
  success(`Saved your settings in ${dockerAppConfigPath}`);

  const hasSecrets = Object.keys(secrets).length > 0;
  if (!hasSecrets) return;

  await saveSecrets(dockerAppConfigPath, secrets);
  success(`Saved your tokens and keys in ${join(paths.configDir, "secrets.yaml")}`);
}

/**
 * Write dev/local config files.
 */
export async function writeDevConfig(
  config: AppConfig,
  secrets: SecretsConfig,
  appConfigPath: string,
): Promise<void> {
  await saveAppConfigWithComments(config, appConfigPath, saveAppConfig);
  success(`Saved your settings in ${appConfigPath}`);

  const hasSecrets = Object.keys(secrets).length > 0;
  if (!hasSecrets) return;

  await saveSecrets(appConfigPath, secrets);
  success(`Saved your tokens and keys in ${dirname(appConfigPath)}/secrets.yaml`);
}

/**
 * Ensure Docker workspace is writable before writing config.
 */
export function prepareDockerWorkspace(paths: DockerPaths): void {
  // Ensure the container's UID/GID can write into bind-mounted dirs BEFORE
  // writing any files. Without this, writeDockerConfigLocalStyle will fail
  // with EACCES when the host directory is owned by a different UID.
  mkdirSync(join(paths.configDir, "auth"), { recursive: true });
  tryMakeTreeWritableForDocker(paths.configDir);
}
