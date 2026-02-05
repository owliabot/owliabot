import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebFetchTool } from "../web-fetch.js";
import type { ToolContext } from "../../interface.js";

describe("builtin/web_fetch tool", () => {
  const mockContext: ToolContext = {
    sessionKey: "test-session",
    agentId: "test-agent",
    signer: null,
    config: {},
  };

  const defaultDeps = {
    config: {
      domainAllowList: [],
      domainDenyList: [],
      allowPrivateNetworks: false,
      timeoutMs: 5000,
      maxResponseBytes: 1024,
      userAgent: "test-agent",
      blockOnSecret: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct metadata", () => {
    const tool = createWebFetchTool(defaultDeps);
    expect(tool.name).toBe("web_fetch");
    expect(tool.security.level).toBe("read");
    expect(tool.parameters.required).toContain("url");
  });

  it("rejects private network URLs by default", async () => {
    const tool = createWebFetchTool(defaultDeps);
    const result = await tool.execute({ url: "http://127.0.0.1:8080/test" }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked|denied|private/i);
  });

  it("accepts public URLs with mock fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: Buffer.from("test content") })
            .mockResolvedValueOnce({ done: true }),
          cancel: vi.fn(),
        }),
      },
      headers: new Headers({ "content-type": "text/plain" }),
    });

    const tool = createWebFetchTool({
      ...defaultDeps,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await tool.execute({ url: "https://example.com/" }, mockContext);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      status: 200,
      body: "test content",
    });
  });

  it("blocks POST body containing secrets", async () => {
    const mockFetch = vi.fn();

    const tool = createWebFetchTool({
      config: {
        ...defaultDeps.config,
        blockOnSecret: true,
      },
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    // Body contains something that looks like an API key
    const result = await tool.execute({
      url: "https://example.com/api",
      method: "POST",
      body: "api_key=sk-1234567890abcdef1234567890abcdef",
    }, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
