import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { Config as AppConfig } from "../config/schema.js";
import { ensureOwliabotHomeEnv, resolveHomeDir } from "../utils/paths.js";

const HOME = resolveHomeDir();

/** Check if running in dev mode (OWLIABOT_DEV=1 or OWLIABOT_DEV=true) */
export const IS_DEV_MODE = ["1", "true"].includes(process.env.OWLIABOT_DEV?.toLowerCase() ?? "");

/** Production config directory (~/.owliabot) */
export const PROD_APP_DIR = ensureOwliabotHomeEnv();

/** Dev config directory (~/.owlia_dev) - only used when OWLIABOT_DEV=1 */
export const DEV_APP_DIR = join(HOME, ".owlia_dev");

/** Default config directory (production unless OWLIABOT_DEV=1) */
export const DEFAULT_APP_DIR = IS_DEV_MODE ? DEV_APP_DIR : PROD_APP_DIR;

/** Default app config path */
export const DEFAULT_APP_CONFIG_PATH = join(DEFAULT_APP_DIR, "app.yaml");

/** @deprecated Use DEFAULT_APP_CONFIG_PATH instead */
export const DEV_APP_CONFIG_PATH = DEFAULT_APP_CONFIG_PATH;

export async function loadAppConfig(
  path: string = DEV_APP_CONFIG_PATH
): Promise<AppConfig | null> {
  try {
    const content = await readFile(path, "utf-8");
    return parse(content) as AppConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveAppConfig(
  config: AppConfig,
  path: string = DEV_APP_CONFIG_PATH
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = stringify(config, { indent: 2 });
  await writeFile(path, content, "utf-8");
}
