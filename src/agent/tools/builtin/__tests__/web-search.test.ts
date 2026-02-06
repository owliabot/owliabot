import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebSearchTool } from "../web-search.js";
import type { ToolContext } from "../../interface.js";

describe("builtin/web_search tool", () => {
  const mockContext: ToolContext = {
    sessionKey: "test-session",
    agentId: "test-agent",
    config: {},
  };

  const defaultDeps = {
    config: {
      web: {
        domainAllowList: [],
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 5000,
        maxResponseBytes: 1024,
        userAgent: "test-agent",
        blockOnSecret: true,
      },
      webSearch: {
        defaultProvider: "duckduckgo" as const,
        timeoutMs: 5000,
        maxResults: 10,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct metadata", () => {
    const tool = createWebSearchTool(defaultDeps);
    expect(tool.name).toBe("web_search");
    expect(tool.security.level).toBe("read");
    expect(tool.parameters.required).toContain("query");
  });

  it("requires brave API key for brave provider", async () => {
    const tool = createWebSearchTool(defaultDeps);
    const result = await tool.execute({ query: "test", provider: "brave" }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/API key/i);
  });

  it("searches with DuckDuckGo using mock fetch", async () => {
    const mockHtml = `
      <html>
      <body>
        <a class="result__a" href="https://example.com">Example Title</a>
      </body>
      </html>
    `;
    const mockFetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockHtml),
    });

    const tool = createWebSearchTool({
      ...defaultDeps,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await tool.execute({ query: "test query" }, mockContext);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      provider: "duckduckgo",
      query: "test query",
    });
  });

  it("searches with Brave using mock fetch when API key configured", async () => {
    const mockJson = {
      web: {
        results: [
          { title: "Test Result", url: "https://example.com", description: "A test result" },
          { title: "Another Result", url: "https://example.org", description: "Another one" },
        ],
      },
    };
    const mockFetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify(mockJson)),
    });

    const tool = createWebSearchTool({
      config: {
        ...defaultDeps.config,
        webSearch: {
          ...defaultDeps.config.webSearch,
          defaultProvider: "brave",
          brave: {
            apiKey: "test-api-key",
          },
        },
      },
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await tool.execute({ query: "test query", provider: "brave" }, mockContext);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      provider: "brave",
      query: "test query",
    });
    expect((result.data as any).results).toHaveLength(2);
    expect((result.data as any).results[0].title).toBe("Test Result");
  });
});
