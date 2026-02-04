import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemorySearchTool } from "../memory-search.js";
import * as memorySearch from "../../../../workspace/memory-search.js";

vi.mock("../../../../workspace/memory-search.js");

describe("memory-search tool", () => {
  const workspacePath = "/test/workspace";
  let memorySearchTool: ReturnType<typeof createMemorySearchTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    memorySearchTool = createMemorySearchTool(workspacePath);
  });

  it("should search memory and return results", async () => {
    const mockResults = [
      {
        path: "memory/2026-01-01.md",
        startLine: 0,
        endLine: 2,
        snippet: "Found something interesting",
      },
      {
        path: "memory/2026-01-02.md",
        startLine: 5,
        endLine: 7,
        snippet: "Another match here",
      },
    ];

    vi.mocked(memorySearch.searchMemory).mockResolvedValue(mockResults);

    const result = await memorySearchTool.execute(
      { query: "interesting" },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.message).toContain("Found 2");
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toEqual({
      path: "memory/2026-01-01.md",
      lines: "1-3",
      snippet: "Found something interesting",
    });
  });

  it("should use default max_results of 5", async () => {
    vi.mocked(memorySearch.searchMemory).mockResolvedValue([]);

    await memorySearchTool.execute({ query: "test" }, {} as any);

    expect(memorySearch.searchMemory).toHaveBeenCalledWith(
      workspacePath,
      "test",
      { maxResults: 5 }
    );
  });

  it("should respect custom max_results", async () => {
    vi.mocked(memorySearch.searchMemory).mockResolvedValue([]);

    await memorySearchTool.execute(
      { query: "test", max_results: 10 },
      {} as any
    );

    expect(memorySearch.searchMemory).toHaveBeenCalledWith(
      workspacePath,
      "test",
      { maxResults: 10 }
    );
  });

  it("should return appropriate message when no results found", async () => {
    vi.mocked(memorySearch.searchMemory).mockResolvedValue([]);

    const result = await memorySearchTool.execute(
      { query: "nonexistent" },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.message).toBe("No results found");
    expect(data.results).toEqual([]);
  });

  it("should convert 0-indexed lines to 1-indexed", async () => {
    const mockResults = [
      {
        path: "memory/test.md",
        startLine: 0,
        endLine: 0,
        snippet: "First line",
      },
    ];

    vi.mocked(memorySearch.searchMemory).mockResolvedValue(mockResults);

    const result = await memorySearchTool.execute(
      { query: "test" },
      {} as any
    );

    const data = result.data as any;
    expect(data.results[0].lines).toBe("1-1");
  });

  it("should have correct metadata", () => {
    expect(memorySearchTool.name).toBe("memory_search");
    expect(memorySearchTool.description).toContain("Search through memory");
    expect(memorySearchTool.security.level).toBe("read");
    expect(memorySearchTool.parameters.required).toContain("query");
  });
});
