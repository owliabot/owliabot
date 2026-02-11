/**
 * Check if a hostname resolves via DNS (sync best-effort).
 */
export function canResolveHost(hostname: string): boolean {
  try {
    const { execSync } = require("node:child_process");
    execSync(`getent hosts ${hostname}`, { timeout: 2000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
