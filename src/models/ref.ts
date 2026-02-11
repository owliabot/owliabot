export type ModelRef = { provider: string; model: string };

/**
 * Parse a model reference in `provider/model` form.
 *
 * Notes:
 * - Only the first slash separates provider from model, so models may contain additional slashes
 *   (e.g. "openrouter/moonshotai/kimi-k2").
 * - Returns null for invalid / empty values.
 */
export function parseModelRef(value: string): ModelRef | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const firstSlash = raw.indexOf("/");
  if (firstSlash <= 0) return null; // no slash or provider missing
  if (firstSlash === raw.length - 1) return null; // model missing

  const provider = raw.slice(0, firstSlash).trim();
  const model = raw.slice(firstSlash + 1).trim();
  if (!provider || !model) return null;

  return { provider, model };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

