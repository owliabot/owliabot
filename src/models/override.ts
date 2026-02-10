export type ProviderModelRef = { provider: string; model: string };

type ProviderChainEntry = {
  id: string;
  model: string;
  priority: number;
};

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Apply a session-level primary model override to a failover chain.
 *
 * Behavior:
 * - The selected provider becomes priority=1 (primary)
 * - Other providers keep their relative order (based on existing priorities)
 * - Priorities are rewritten sequentially (1..n) to match callWithFailover sorting
 * - Provider-specific fields (apiKey, baseUrl, etc.) are preserved from the selected entry
 */
export function applyPrimaryModelRefOverride<T extends ProviderChainEntry>(
  providers: readonly T[],
  override: ProviderModelRef,
): T[] {
  const normalizedTarget = normalizeId(override.provider);
  const sorted = [...providers].toSorted((a, b) => a.priority - b.priority);
  const idx = sorted.findIndex((p) => normalizeId(p.id) === normalizedTarget);
  if (idx === -1) {
    throw new Error(`Override provider not found in chain: ${override.provider}`);
  }

  const selected = sorted[idx];
  const remaining = sorted.filter((_, i) => i !== idx);

  const next: T[] = [
    { ...selected, model: override.model, priority: 1 },
    ...remaining.map((p, i) => ({ ...p, priority: i + 2 })),
  ] as T[];

  return next;
}

