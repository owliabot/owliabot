/**
 * Parameter redaction for audit logs
 * @see docs/design/audit-strategy.md Section 7.1
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("audit-redact");

const SENSITIVE_KEYS = [
  "privatekey",
  "private_key",
  "seed",
  "mnemonic",
  "secret",
  "password",
  "apikey",
  "api_key",
  "token",
  "auth",
  "authorization",
];

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export function redactParams(
  params: Record<string, unknown>
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    // Remove sensitive fields completely
    if (SENSITIVE_KEYS.some((sk) => key.toLowerCase().includes(sk))) {
      redacted[key] = "[REDACTED]";
      log.debug(`Redacted sensitive key: ${key}`);
      continue;
    }

    // Keep addresses (public information)
    if (typeof value === "string" && ADDRESS_PATTERN.test(value)) {
      redacted[key] = value;
      continue;
    }

    // Keep transaction hashes (public information)
    if (typeof value === "string" && TX_HASH_PATTERN.test(value)) {
      redacted[key] = value;
      continue;
    }

    // Truncate long strings
    if (typeof value === "string" && value.length > 200) {
      redacted[key] = value.slice(0, 50) + "...[truncated]";
      continue;
    }

    // Recursively redact nested objects
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      redacted[key] = redactParams(value as Record<string, unknown>);
      continue;
    }

    // Redact arrays with nested objects
    if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? redactParams(item as Record<string, unknown>)
          : item
      );
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
}
