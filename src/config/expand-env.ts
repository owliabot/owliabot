export function expandEnvVarsDeep(
  obj: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => env[key] ?? "");
  }
  if (Array.isArray(obj)) return obj.map((v) => expandEnvVarsDeep(v, env));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = expandEnvVarsDeep(v, env);
    return out;
  }
  return obj;
}

