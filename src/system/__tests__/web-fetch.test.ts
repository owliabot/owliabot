import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { webFetchAction } from "../actions/web-fetch.js";

function listen(server: http.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("system/actions/web-fetch", () => {
  let srv: http.Server;
  let baseUrl = "";
  let close: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(10_000));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    const l = await listen(srv);
    baseUrl = `http://127.0.0.1:${l.port}`;
    close = l.close;
  });

  afterAll(async () => {
    await close?.();
  });

  it("fetches allowed URL and returns body", async () => {
    const r = await webFetchAction(
      { url: baseUrl + "/" },
      { fetchImpl: fetch },
      {
        domainAllowList: ["127.0.0.1"],
        domainDenyList: [],
        allowPrivateNetworks: true,
        timeoutMs: 5_000,
        maxResponseBytes: 100_000,
        userAgent: "vitest",
        blockOnSecret: true,
      }
    );

    expect(r.status).toBe(200);
    expect(r.bodyText).toBe("ok");
  });

  it("truncates large responses", async () => {
    const r = await webFetchAction(
      { url: baseUrl + "/big", maxResponseBytes: 1000 },
      { fetchImpl: fetch },
      {
        domainAllowList: ["127.0.0.1"],
        domainDenyList: [],
        allowPrivateNetworks: true,
        timeoutMs: 5_000,
        maxResponseBytes: 1000,
        userAgent: "vitest",
        blockOnSecret: true,
      }
    );

    expect(r.truncated).toBe(true);
    expect(r.bodyText.length).toBeLessThanOrEqual(1000);
  });

  it("blocks POST bodies with high-confidence secrets", async () => {
    await expect(
      webFetchAction(
        {
          url: baseUrl + "/",
          method: "POST",
          body: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        },
        { fetchImpl: fetch },
        {
          domainAllowList: ["127.0.0.1"],
          domainDenyList: [],
          allowPrivateNetworks: true,
          timeoutMs: 5_000,
          maxResponseBytes: 100_000,
          userAgent: "vitest",
          blockOnSecret: true,
        }
      )
    ).rejects.toThrow(/secret scanner/);
  });
});
