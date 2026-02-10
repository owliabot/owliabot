import { getModels, type Api, type Model as PiModel } from "@mariozechner/pi-ai";

export type ProviderConfigLike = {
  id: string;
  model: string;
  priority?: number;
};

export type ModelCatalogEntry = {
  key: string; // provider/model
  provider: string;
  model: string;
  name: string;
  source: "pi-ai" | "configured";
};

// SYNC: Keep this set in sync with the provider ids supported by @mariozechner/pi-ai.
const PI_PROVIDER_IDS = new Set<string>(["anthropic", "openai", "openai-codex", "google"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchesFilter(entry: ModelCatalogEntry, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  return (
    entry.key.toLowerCase().includes(f) ||
    entry.name.toLowerCase().includes(f) ||
    entry.model.toLowerCase().includes(f) ||
    entry.provider.toLowerCase().includes(f)
  );
}

/**
 * Build a model catalog for the set of providers configured in app.yaml.
 *
 * Default policy:
 * - For pi-ai backed providers (anthropic/openai/openai-codex/google), list *all* models from pi-ai.
 * - For custom providers (e.g. openai-compatible), fall back to listing only the configured model.
 */
export function listConfiguredModelCatalog(params: {
  providers: readonly ProviderConfigLike[];
  filter?: string;
}): ModelCatalogEntry[] {
  const filter = params.filter?.trim() ?? "";

  const configuredProviders = params.providers
    .map((p) => ({
      id: String(p.id ?? "").trim(),
      model: String(p.model ?? "").trim(),
    }))
    .filter((p) => p.id && p.model);

  const uniqueProviderIds: string[] = [];
  const seen = new Set<string>();
  for (const p of configuredProviders) {
    const key = normalize(p.id);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueProviderIds.push(p.id);
  }

  const out: ModelCatalogEntry[] = [];

  for (const providerId of uniqueProviderIds) {
    const providerKey = normalize(providerId);
    if (PI_PROVIDER_IDS.has(providerKey)) {
      // pi-ai provider: use built-in model list
      const models = getModels(providerKey as never) as PiModel<Api>[];
      for (const m of models) {
        const id = String(m.id ?? "").trim();
        if (!id) continue;
        out.push({
          provider: providerKey,
          model: id,
          key: `${providerKey}/${id}`,
          name: String((m as any).name ?? id).trim() || id,
          source: "pi-ai",
        });
      }
      continue;
    }

    // Non pi-ai provider: list configured model only (we can't discover full catalog).
    const configured = configuredProviders.find((p) => normalize(p.id) === providerKey);
    if (!configured) continue;
    out.push({
      provider: providerKey,
      model: configured.model,
      key: `${providerKey}/${configured.model}`,
      name: configured.model,
      source: "configured",
    });
  }

  const filtered = filter ? out.filter((entry) => matchesFilter(entry, filter)) : out;
  return filtered.toSorted((a, b) => {
    const p = a.provider.localeCompare(b.provider);
    if (p !== 0) return p;
    return a.model.localeCompare(b.model);
  });
}
