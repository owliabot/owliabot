import { basename } from "node:path";

export interface CommandWhitelistVerdict {
  allowed: boolean;
  reason?: string;
}

const SAFE_CMD_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate an exec command against an allowlist.
 *
 * Security model:
 * - Only explicit allowlist entries are allowed.
 * - Deny any command containing path separators or whitespace.
 */
export function checkCommandWhitelist(
  command: string,
  allowList: string[]
): CommandWhitelistVerdict {
  if (!command || typeof command !== "string") {
    return { allowed: false, reason: "command_required" };
  }

  // Disallow explicit paths (./bin, /usr/bin) and whitespace
  if (command !== basename(command)) {
    return { allowed: false, reason: "command_must_be_basename" };
  }
  if (!SAFE_CMD_RE.test(command)) {
    return { allowed: false, reason: "command_invalid_characters" };
  }

  if (!Array.isArray(allowList) || allowList.length === 0) {
    return { allowed: false, reason: "allowlist_empty" };
  }

  if (!allowList.includes(command)) {
    return { allowed: false, reason: "command_not_allowlisted" };
  }

  return { allowed: true };
}
