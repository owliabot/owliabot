import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { AppConfig } from "./types.js";

export const DEV_APP_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".owlia_dev"
);

export const DEV_APP_CONFIG_PATH = join(DEV_APP_DIR, "app.yaml");

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
