export interface EnvSanitizeResult {
  env: Record<string, string>;
  strippedKeys: string[];
}

const SENSITIVE_NAME_RE = /(api[_-]?key|token|secret|pass(word)?|private|mnemonic|seed|session)/i;

/**
 * Build a clean environment object for exec.
 *
 * Rules:
 * - Start from a minimal base (no full process.env inheritance).
 * - Allow only keys present in allowList.
 * - Never allow keys that look sensitive, even if in allowList.
 */
export function sanitizeEnv(
  provided: Record<string, string> | undefined,
  allowList: string[]
): EnvSanitizeResult {
  const strippedKeys: string[] = [];
  const env: Record<string, string> = {};

  const allow = new Set((allowList ?? []).filter((k) => typeof k === "string" && k.length > 0));

  const src = provided ?? {};
  for (const [k, v] of Object.entries(src)) {
    if (!allow.has(k)) {
      strippedKeys.push(k);
      continue;
    }
    if (SENSITIVE_NAME_RE.test(k)) {
      strippedKeys.push(k);
      continue;
    }
    if (typeof v !== "string") {
      strippedKeys.push(k);
      continue;
    }
    // Basic normalization - disallow null bytes
    if (v.includes("\u0000")) {
      strippedKeys.push(k);
      continue;
    }
    env[k] = v;
  }

  // Provide PATH only if explicitly allowed, sourced from host env.
  if (allow.has("PATH") && !env.PATH && typeof process.env.PATH === "string") {
    env.PATH = process.env.PATH;
  }

  // Provide locale vars only if allowed
  if (allow.has("LANG") && !env.LANG && typeof process.env.LANG === "string") {
    env.LANG = process.env.LANG;
  }

  return { env, strippedKeys };
}
