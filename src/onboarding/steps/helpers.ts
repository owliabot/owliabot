/**
 * Helper utilities for onboarding
 */

import { readFileSync, writeFileSync } from "node:fs";

/**
 * Detect the system timezone, falling back to UTC if unavailable.
 */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.trim().length > 0) return tz.trim();
  } catch {
    // ignore
  }
  return "UTC";
}

/**
 * Inject a comment above the timezone field in the YAML file.
 */
export function injectTimezoneComment(yaml: string): string {
  const comment =
    "# Timezone was auto-detected during setup. Edit this value to override.";
  return yaml.replace(
    /^(timezone:\s*.*)$/m,
    `${comment}\n$1`,
  );
}

/**
 * Save app config with timezone comment injection.
 */
export async function saveAppConfigWithComments(
  config: any,
  path: string,
  saveAppConfig: (config: any, path: string) => Promise<void>
): Promise<void> {
  await saveAppConfig(config, path);
  try {
    const raw = readFileSync(path, "utf-8");
    const next = injectTimezoneComment(raw);
    if (next !== raw) writeFileSync(path, next, "utf-8");
  } catch {
    // best-effort
  }
}
