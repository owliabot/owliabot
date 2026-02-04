export type MemorySearchProviderId = "sqlite" | "naive";

export type MemorySearchSourceId = "files" | "transcripts";

export interface MemorySearchConfig {
  /**
   * When false, the memory_search tool should not access local files/DB.
   * (Fail-closed default is handled by config schema.)
   */
  enabled: boolean;

  /** Primary backend used by memory_search. */
  provider: MemorySearchProviderId;

  /** Optional fallback backend used only if the primary is unavailable/errors. */
  fallback: MemorySearchProviderId | "none";

  store: {
    /** Path to sqlite store; supports {agentId} token. */
    path: string;
  };

  /** Additional directories/files to allow (scanned + included in allowlist). */
  extraPaths: string[];

  /** Which sources to search/index. */
  sources: MemorySearchSourceId[];

  /**
   * Indexing behavior for the sqlite provider.
   * Defaults are fail-closed (autoIndex=false).
   */
  indexing?: {
    autoIndex: boolean;
    minIntervalMs: number;
    /** Optional override for which sources to index (defaults to `sources`). */
    sources?: MemorySearchSourceId[];
  };
}
