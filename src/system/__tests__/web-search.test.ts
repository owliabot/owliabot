import { describe, it, expect } from "vitest";
import { webSearchAction } from "../actions/web-search.js";
import type { SystemCapabilityConfig } from "../interface.js";

describe("system/actions/web-search", () => {
  describe("Brave provider", () => {
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
  });

  describe("DuckDuckGo provider", () => {
    const baseCfg: SystemCapabilityConfig = {
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

    it("parses DuckDuckGo HTML with result__a class", async () => {
      const html = `
        <html><body>
        <div class="results">
          <a class="result__a" href="https://example.com">Example Result</a>
          <a class="result__a" href="https://two.com">Two</a>
        </div>
        </body></html>
      `;

      const fetchImpl: typeof fetch = async () => {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      };

      const r = await webSearchAction({ query: "x", count: 2 }, { fetchImpl }, baseCfg);
      expect(r.provider).toBe("duckduckgo");
      expect(r.results.length).toBe(2);
      expect(r.results[0]).toMatchObject({ title: "Example Result", url: "https://example.com" });
    });

    it("throws clear error on empty response", async () => {
      const fetchImpl: typeof fetch = async () => {
        return new Response("", { status: 200, headers: { "content-type": "text/html" } });
      };

      await expect(
        webSearchAction({ query: "x" }, { fetchImpl }, baseCfg)
      ).rejects.toThrow(/Empty or invalid response/);
    });

    it("throws clear error on non-HTML response", async () => {
      const fetchImpl: typeof fetch = async () => {
        return new Response("plain text without html tags", { status: 200 });
      };

      await expect(
        webSearchAction({ query: "x" }, { fetchImpl }, baseCfg)
      ).rejects.toThrow(/does not appear to be HTML/);
    });

    it("throws clear error when DDG returns rate limit", async () => {
      const html = `<html><head><title>Error</title></head><body>Rate limit exceeded</body></html>`;

      const fetchImpl: typeof fetch = async () => {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      };

      await expect(
        webSearchAction({ query: "x" }, { fetchImpl }, baseCfg)
      ).rejects.toThrow(/error or rate limit/);
    });

    it("throws clear error when HTML structure has changed (no results found)", async () => {
      // Valid HTML but with unexpected structure (no matching result elements)
      const html = `<html><body><div class="unknown-class">Some content</div></body></html>`;

      const fetchImpl: typeof fetch = async () => {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      };

      await expect(
        webSearchAction({ query: "x" }, { fetchImpl }, baseCfg)
      ).rejects.toThrow(/page structure may have changed/);
    });

    it("validates URL shape (rejects non-http URLs)", async () => {
      const html = `
        <html><body>
        <div class="results">
          <a class="result__a" href="javascript:alert('xss')">Bad Link</a>
          <a class="result__a" href="https://valid.com">Valid Link</a>
        </div>
        </body></html>
      `;

      const fetchImpl: typeof fetch = async () => {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      };

      const r = await webSearchAction({ query: "x" }, { fetchImpl }, baseCfg);
      // Should only include the valid https URL
      expect(r.results.length).toBe(1);
      expect(r.results[0].url).toBe("https://valid.com");
    });
  });
});
