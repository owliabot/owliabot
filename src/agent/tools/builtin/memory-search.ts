/**
 * Memory search tool
 */

import type { ToolDefinition } from "../interface.js";
import { searchMemory } from "../../../workspace/memory-search.js";
import { resolveMemoryStorePath } from "../../../memory/config.js";

export function createMemorySearchTool(workspacePath: string): ToolDefinition {
  return {
    name: "memory_search",
    description:
      "Search through memory files for relevant context. Use this to recall past conversations, decisions, or stored information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (keywords to look for)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    security: {
      level: "read",
    },
    async execute(params, ctx) {
      const { query, max_results } = params as {
        query: string;
        max_results?: number;
      };

      // Resolve config (fail-closed defaults).
      const rawCfg = ((ctx?.config as any)?.memorySearch ?? {}) as any;

      const enabled =
        typeof rawCfg.enabled === "boolean" ? rawCfg.enabled : false;

      const provider =
        rawCfg.provider === "naive" || rawCfg.provider === "sqlite"
          ? rawCfg.provider
          : "sqlite";

      const fallback =
        rawCfg.fallback === "naive" || rawCfg.fallback === "sqlite" || rawCfg.fallback === "none"
          ? rawCfg.fallback
          : "none";

      const extraPaths = Array.isArray(rawCfg.extraPaths)
        ? rawCfg.extraPaths
            .filter((p: unknown) => typeof p === "string")
            .map((p: string) => p.trim())
            .filter(Boolean)
        : [];

      const sources = Array.isArray(rawCfg.sources)
        ? rawCfg.sources
            .filter((s: unknown) => typeof s === "string")
            .map((s: string) => s.trim())
            .filter((s: string) => s === "files" || s === "transcripts")
        : ["files"];

      const rawIndexing = (rawCfg.indexing ?? {}) as any;
      const autoIndex =
        typeof rawIndexing.autoIndex === "boolean" ? rawIndexing.autoIndex : false;
      const minIntervalMs =
        typeof rawIndexing.minIntervalMs === "number" &&
        Number.isFinite(rawIndexing.minIntervalMs) &&
        rawIndexing.minIntervalMs >= 0
          ? Math.floor(rawIndexing.minIntervalMs)
          : 5 * 60 * 1000;
      const indexingSources: Array<"files" | "transcripts"> | undefined = Array.isArray(rawIndexing.sources)
        ? (rawIndexing.sources as unknown[])
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim())
            .filter((s): s is "files" | "transcripts" => s === "files" || s === "transcripts")
        : undefined;
      const indexing = {
        autoIndex,
        minIntervalMs,
        sources:
          indexingSources && indexingSources.length > 0
            ? (Array.from(new Set(indexingSources)) as Array<"files" | "transcripts">)
            : undefined,
      };

      const storePath =
        typeof rawCfg?.store?.path === "string" && rawCfg.store.path.trim()
          ? rawCfg.store.path
          : "~/.owliabot/memory/{agentId}.sqlite";

      const agentId =
        typeof ctx?.agentId === "string" && ctx.agentId ? ctx.agentId : "default";

      if (!enabled) {
        return {
          success: true,
          data: { message: "No results found", results: [] },
        };
      }

      let dbPath: string | undefined;
      try {
        dbPath = resolveMemoryStorePath({
          config: {
            enabled: true,
            provider,
            fallback,
            store: { path: storePath },
            extraPaths,
          } as any,
          agentId,
        });
      } catch {
        dbPath = undefined;
      }

      const results = await searchMemory(workspacePath, query, {
        maxResults: max_results ?? 5,
        extraPaths,
        dbPath,
        provider,
        fallback,
        sources,
        indexing,
      });

      if (results.length === 0) {
        return {
          success: true,
          data: { message: "No results found", results: [] },
        };
      }

      return {
        success: true,
        data: {
          message: `Found ${results.length} result(s)`,
          results: results.map((r) => ({
            path: r.path,
            lines: `${r.startLine + 1}-${r.endLine + 1}`,
            snippet: r.snippet,
          })),
        },
      };
    },
  };
}
