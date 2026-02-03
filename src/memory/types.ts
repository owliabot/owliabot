export type EmbeddingProviderId = "openai" | "gemini" | "local";

export interface MemorySearchConfig {
  enabled: boolean;
  provider: EmbeddingProviderId;
  model?: string;
  /** Optional fallback provider; "none" disables fallback */
  fallback: EmbeddingProviderId | "none";
  store: {
    /** Path to sqlite store; supports {agentId} token. */
    path: string;
  };
  /** Additional directories/files to index (future use). */
  extraPaths: string[];
}

export interface EmbeddingProviderStatus {
  ok: boolean;
  provider: EmbeddingProviderId;
  model?: string;
  reason?: string;
  fallbackFrom?: EmbeddingProviderId;
}
