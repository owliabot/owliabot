/**
 * Web Fetch tool - Fetch content from URLs
 * Wraps system/actions/web-fetch for LLM access
 */
import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import { webFetchAction, type WebFetchActionContext } from "../../../system/actions/web-fetch.js";
import type { SystemCapabilityConfig } from "../../../system/interface.js";

export interface WebFetchToolDeps {
  config: NonNullable<SystemCapabilityConfig["web"]>;
  fetchImpl?: typeof fetch;
}

export function createWebFetchTool(deps: WebFetchToolDeps): ToolDefinition {
  return {
    name: "web_fetch",
    description: `Fetch content from a URL.

SECURITY:
- URLs are checked against domain allowlist/denylist
- Private networks blocked by default
- Request bodies scanned for secrets
- Response size limited

METHODS: GET, POST, HEAD

USAGE:
- url: The URL to fetch (required)
- method: HTTP method (default: GET)
- headers: Optional request headers
- body: Optional request body (for POST)
- timeoutMs: Optional timeout override`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, HEAD)",
          enum: ["GET", "POST", "HEAD"],
        },
        headers: {
          type: "object",
          description: "Request headers",
        },
        body: {
          type: "string",
          description: "Request body (for POST)",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds",
        },
      },
      required: ["url"],
    },
    security: {
      level: "read",
    },
    async execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
      const p = params as WebFetchToolParams;

      try {
        const actionCtx: WebFetchActionContext = {
          fetchImpl: deps.fetchImpl,
        };

        const result = await webFetchAction(p, actionCtx, deps.config);

        return {
          success: result.status >= 200 && result.status < 400,
          data: {
            url: result.url,
            status: result.status,
            headers: result.headers,
            body: result.bodyText,
            truncated: result.truncated,
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

interface WebFetchToolParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}
