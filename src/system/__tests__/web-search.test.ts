import { describe, it, expect } from "vitest";
import { webSearchAction } from "../actions/web-search.js";
import type { SystemCapabilityConfig } from "../interface.js";

describe("system/actions/web-search", () => {
  it("uses Brave provider when configured", async () => {
    const cfg: SystemCapabilityConfig = {
      web: {
        domainAllowList: ["api.search.brave.com"],
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 10_000,
        maxResponseBytes: 512 * 1024,
        userAgent: "vitest",
        blockOnSecret: true,
      },
      webSearch: {
        defaultProvider: "brave",
        brave: { apiKey: "brave-key", endpoint: "https://api.search.brave.com/res/v1/web/search" },
        timeoutMs: 10_000,
        maxResults: 10,
      },
    };

    const fetchImpl: typeof fetch = async () => {
      const body = JSON.stringify({
        web: {
          results: [
            { title: "Example", url: "https://example.com", description: "desc" },
            { title: "Two", url: "https://two.com" },
          ],
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    };

    const r = await webSearchAction({ query: "x", provider: "brave", count: 2 }, { fetchImpl }, cfg);
    expect(r.provider).toBe("brave");
    expect(r.results.length).toBe(2);
    expect(r.results[0]).toMatchObject({ title: "Example", url: "https://example.com" });
    expect(r.results[0].snippet).toBe("desc");
  });

  it("falls back to DuckDuckGo parsing", async () => {
    const cfg: SystemCapabilityConfig = {
      web: {
        domainAllowList: ["duckduckgo.com"],
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 10_000,
        maxResponseBytes: 512 * 1024,
        userAgent: "vitest",
        blockOnSecret: true,
      },
      webSearch: {
        defaultProvider: "duckduckgo",
        duckduckgo: { endpoint: "https://duckduckgo.com/html/" },
        timeoutMs: 10_000,
        maxResults: 10,
      },
    };

    const html = `
      <div class="results">
        <a class="result__a" href="https://example.com">Example Result</a>
        <a class="result__a" href="https://two.com">Two</a>
      </div>
    `;

    const fetchImpl: typeof fetch = async () => {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    };

    const r = await webSearchAction({ query: "x", count: 2 }, { fetchImpl }, cfg);
    expect(r.provider).toBe("duckduckgo");
    expect(r.results.length).toBe(2);
    expect(r.results[0]).toMatchObject({ title: "Example Result", url: "https://example.com" });
  });
});
