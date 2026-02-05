/**
 * Web Search tool - Search the web via Brave or DuckDuckGo
 * Wraps system/actions/web-search for LLM access
 */
import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import { webSearchAction, type WebSearchActionContext } from "../../../system/actions/web-search.js";
import type { SystemCapabilityConfig } from "../../../system/interface.js";

export interface WebSearchToolDeps {
  config: SystemCapabilityConfig;
  fetchImpl?: typeof fetch;
}

export function createWebSearchTool(deps: WebSearchToolDeps): ToolDefinition {
  return {
    name: "web_search",
    description: `Search the web using Brave Search or DuckDuckGo.

PROVIDERS:
- brave: Requires API key, returns structured results with snippets
- duckduckgo: No API key needed, HTML scraping (best-effort)

USAGE:
- query: Search query string (required)
- count: Number of results (1-50, default 10)
- provider: "brave" or "duckduckgo" (optional, uses configured default)
- timeoutMs: Optional timeout override`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        count: {
          type: "number",
          description: "Number of results to return (1-50)",
        },
        provider: {
          type: "string",
          description: "Search provider",
          enum: ["brave", "duckduckgo"],
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds",
        },
      },
      required: ["query"],
    },
    security: {
      level: "read",
    },
    async execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
      const p = params as WebSearchToolParams;

      try {
        const actionCtx: WebSearchActionContext = {
          fetchImpl: deps.fetchImpl,
        };

        const result = await webSearchAction(p, actionCtx, deps.config);

        return {
          success: true,
          data: {
            provider: result.provider,
            query: result.query,
            results: result.results,
            durationMs: result.durationMs,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

interface WebSearchToolParams {
  query: string;
  count?: number;
  provider?: "brave" | "duckduckgo";
  timeoutMs?: number;
}
