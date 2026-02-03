import type { EmbeddingProviderId, EmbeddingProviderStatus, MemorySearchConfig } from "../types.js";

export interface EmbeddingProvider {
  id: EmbeddingProviderId;
  model?: string;
  /** Best-effort probe used to decide whether to enable search. */
  probe(): Promise<EmbeddingProviderStatus>;
}

export async function createEmbeddingProvider(config: MemorySearchConfig): Promise<EmbeddingProvider> {
  // Skeleton only (PR3-1). Real implementations will come later.
  return {
    id: config.provider,
    model: config.model,
    async probe() {
      return {
        ok: false,
        provider: config.provider,
        model: config.model,
        reason: "embedding provider not implemented (PR3-1 scaffold)",
      };
    },
  };
}
