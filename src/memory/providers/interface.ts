import type { MemorySearchProviderId } from "../types.js";

export interface MemorySearchProvider<SearchResult> {
  id: MemorySearchProviderId;

  /**
   * Execute a search.
   *
   * Return `null` to indicate the provider is unavailable (e.g. sqlite DB missing)
   * or errored in a way that should trigger fallback.
   */
  trySearch(params: {
    workspaceDir: string;
    query: string;
    maxResults: number;
    extraPaths: string[];
    dbPath?: string;
  }): Promise<SearchResult[] | null>;
}
