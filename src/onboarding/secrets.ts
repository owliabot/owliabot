import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

export interface SecretsConfig {
  discord?: { token?: string };
  telegram?: { token?: string };
  /** OpenAI API key (for openai provider, not OAuth) */
  openai?: { apiKey?: string };
  /** Anthropic API key (alternative to OAuth) */
  anthropic?: { apiKey?: string };
}

export function getSecretsPath(appConfigPath: string): string {
  return join(dirname(appConfigPath), "secrets.yaml");
}

export async function loadSecrets(appConfigPath: string): Promise<SecretsConfig | null> {
  const secretsPath = getSecretsPath(appConfigPath);
  try {
    const content = await readFile(secretsPath, "utf-8");
    return (parse(content) as SecretsConfig) ?? null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveSecrets(
  appConfigPath: string,
  secrets: SecretsConfig
): Promise<void> {
  const secretsPath = getSecretsPath(appConfigPath);
  await mkdir(dirname(secretsPath), { recursive: true });
  const content = stringify(secrets, { indent: 2 });
  await writeFile(secretsPath, content, "utf-8");
  // Best-effort permissions hardening
  try {
    await chmod(secretsPath, 0o600);
  } catch {
    // ignore
  }
}
