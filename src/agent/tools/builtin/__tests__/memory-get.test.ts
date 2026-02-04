import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryGetTool } from "../memory-get.js";
import { readFile } from "node:fs/promises";

vi.mock("node:fs/promises");

describe("memory-get tool", () => {
  const workspacePath = "/test/workspace";
  let memoryGetTool: ReturnType<typeof createMemoryGetTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryGetTool = createMemoryGetTool(workspacePath);
  });

  it("should read file lines with default parameters", async () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      { path: "memory/test.md" },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.from_line).toBe(1);
    expect(data.content).toBe("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
  });

  it("should read specific line range", async () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        from_line: 2,
        num_lines: 2,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.from_line).toBe(2);
    expect(data.to_line).toBe(3); // from_line 2 + num_lines 2 - 1 = line 3
    expect(data.content).toBe("Line 2\nLine 3");
  });

  it("should handle reading beyond end of file", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        from_line: 2,
        num_lines: 100,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.to_line).toBe(3); // Should stop at actual end
    expect(data.content).toBe("Line 2\nLine 3");
  });

  it("should handle from_line = 0", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        from_line: 0,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.from_line).toBe(0);
    expect(data.content).toBe("Line 3");
  });

  it("should handle negative from_line values", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        from_line: -2,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.from_line).toBe(-2);
    expect(data.content).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should handle num_lines = 0", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        num_lines: 0,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.to_line).toBe(0);
    expect(data.content).toBe("");
  });

  it("should handle negative num_lines values", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        num_lines: -1,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.to_line).toBe(-1);
    expect(data.content).toBe("Line 1\nLine 2");
  });

  it("should handle NaN num_lines values", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      {
        path: "memory/test.md",
        num_lines: Number.NaN,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(Number.isNaN(data.to_line)).toBe(true);
    expect(data.content).toBe("");
  });

  it("should reject paths with ..", async () => {
    const result = await memoryGetTool.execute(
      { path: "../etc/passwd" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid path");
  });

  it("should reject absolute paths", async () => {
    const result = await memoryGetTool.execute(
      { path: "/etc/passwd" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid path");
  });

  it("should return error when file not found", async () => {
    const error: any = new Error("ENOENT");
    error.code = "ENOENT";
    vi.mocked(readFile).mockRejectedValue(error);

    const result = await memoryGetTool.execute(
      { path: "memory/missing.md" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
  });

  it("should include total line count in response", async () => {
    const content = "Line 1\nLine 2\nLine 3";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await memoryGetTool.execute(
      { path: "memory/test.md" },
      {} as any
    );

    const data = result.data as any;
    expect(data.total_lines).toBe(3);
  });

  it("should handle empty files", async () => {
    vi.mocked(readFile).mockResolvedValue("");

    const result = await memoryGetTool.execute(
      { path: "memory/empty.md" },
      {} as any
    );

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.total_lines).toBe(1); // Empty file still has 1 line (empty string)
    expect(data.content).toBe("");
  });

  it("should have correct metadata", () => {
    expect(memoryGetTool.name).toBe("memory_get");
    expect(memoryGetTool.description).toContain("Get specific lines");
    expect(memoryGetTool.security.level).toBe("read");
    expect(memoryGetTool.parameters.required).toContain("path");
  });
});
