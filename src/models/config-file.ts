import { parse, stringify } from "yaml";

import { applyPrimaryModelRefOverride, type ProviderModelRef } from "./override.js";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmpPath, contents, "utf-8");
  await rename(tmpPath, filePath);
}

async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts?: { lockTimeoutMs?: number; lockRetryMs?: number }
): Promise<T> {
  const lockTimeoutMs = opts?.lockTimeoutMs ?? 10_000;
  const lockRetryMs = opts?.lockRetryMs ?? 100;

  await mkdir(dirname(lockPath), { recursive: true });

  const start = Date.now();
  while (true) {
    try {
      const fh = await open(lockPath, "wx");
      try {
        await fh.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + "\n",
          "utf-8"
        );
      } catch {
        // ignore
      } finally {
        await fh.close();
      }

      try {
        return await fn();
      } finally {
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;

      // Best-effort stale lock cleanup.
      try {
        const st = await stat(lockPath);
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > lockTimeoutMs) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        // ignore
      }

      if (Date.now() - start > lockTimeoutMs) {
        throw new Error(`Timed out acquiring lock for ${lockPath}`);
      }

      await sleep(lockRetryMs);
    }
  }
}

/**
 * Update `providers[]` in an app.yaml string so the given model ref becomes the
 * primary provider (priority=1) and its model id is updated.
 *
 * Important: this parses the YAML as-is (no env expansion, no secrets merging),
 * to avoid accidentally writing resolved secrets back into app.yaml.
 */
export function updateAppConfigYamlPrimaryModel(yamlText: string, override: ProviderModelRef): string {
  const doc = parse(yamlText) as any;
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid YAML config: expected mapping at root");
  }

  if (!Array.isArray(doc.providers)) {
    throw new Error("Invalid YAML config: missing providers[]");
  }

  doc.providers = applyPrimaryModelRefOverride(doc.providers, override);
  return stringify(doc);
}

export async function updateYamlFileAtomic(
  filePath: string,
  updater: (raw: string) => string | Promise<string>,
  opts?: { lockTimeoutMs?: number; lockRetryMs?: number }
): Promise<void> {
  const lockPath = `${filePath}.lock`;
  await withFileLock(lockPath, async () => {
    const raw = await readFile(filePath, "utf-8");
    const next = await updater(raw);
    await writeFileAtomic(filePath, next);
  }, opts);
}

export async function updateAppConfigFilePrimaryModel(
  filePath: string,
  override: ProviderModelRef,
  opts?: { lockTimeoutMs?: number; lockRetryMs?: number }
): Promise<void> {
  await updateYamlFileAtomic(
    filePath,
    (raw) => updateAppConfigYamlPrimaryModel(raw, override),
    opts
  );
}
