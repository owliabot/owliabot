import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEditFileTool } from "../edit-file.js";
import { readFile, writeFile } from "node:fs/promises";

vi.mock("node:fs/promises");

describe("edit-file tool", () => {
  const workspacePath = "/test/workspace";
  let editFileTool: ReturnType<typeof createEditFileTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    editFileTool = createEditFileTool({ workspace: workspacePath });
  });

  it("should replace exact text in file", async () => {
    const originalContent = "Hello World\nThis is a test\n";
    vi.mocked(readFile).mockResolvedValue(originalContent);
    vi.mocked(writeFile).mockResolvedValue();

    const result = await editFileTool.execute(
      {
        path: "test.txt",
        old_text: "Hello World",
        new_text: "Hello Everyone",
      },
      {} as any
    );

    expect(result.success).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("test.txt"),
      "Hello Everyone\nThis is a test\n",
      "utf-8"
    );
  });

  it("should reject paths with ..", async () => {
    const result = await editFileTool.execute(
      {
        path: "../etc/passwd",
        old_text: "root",
        new_text: "hacker",
      },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid path");
  });

  it("should reject absolute paths", async () => {
    const result = await editFileTool.execute(
      {
        path: "/etc/passwd",
        old_text: "root",
        new_text: "hacker",
      },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid path");
  });

  it("should return error when text not found", async () => {
    vi.mocked(readFile).mockResolvedValue("Hello World\n");

    const result = await editFileTool.execute(
      {
        path: "test.txt",
        old_text: "Nonexistent",
        new_text: "New",
      },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not find the text");
  });

  it("should return error when file not found", async () => {
    const error: any = new Error("ENOENT");
    error.code = "ENOENT";
    vi.mocked(readFile).mockRejectedValue(error);

    const result = await editFileTool.execute(
      {
        path: "missing.txt",
        old_text: "test",
        new_text: "new",
      },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
  });

  it("should handle multiple occurrences error", async () => {
    const content = "test\ntest\ntest\n";
    vi.mocked(readFile).mockResolvedValue(content);

    const result = await editFileTool.execute(
      {
        path: "test.txt",
        old_text: "test",
        new_text: "new",
      },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("occurrences");
  });

  it("should return error when no changes made", async () => {
    vi.mocked(readFile).mockResolvedValue("Hello World\n");

    const result = await editFileTool.execute(
      {
        path: "test.txt",
        old_text: "Hello World",
        new_text: "Hello World",
      },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No changes made");
  });

  it("should handle fuzzy whitespace matching", async () => {
    const content = "function test() {\n  console.log('hi');\n}\n";
    vi.mocked(readFile).mockResolvedValue(content);
    vi.mocked(writeFile).mockResolvedValue();

    const result = await editFileTool.execute(
      {
        path: "test.js",
        old_text: "function test() {\n\tconsole.log('hi');\n}",
        new_text: "function test() {\n  console.log('hello');\n}",
      },
      {} as any
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("usedFuzzyMatch");
  });

  it("should preserve BOM if present", async () => {
    const bomContent = "\uFEFFHello World\n";
    vi.mocked(readFile).mockResolvedValue(bomContent);
    vi.mocked(writeFile).mockResolvedValue();

    const result = await editFileTool.execute(
      {
        path: "test.txt",
        old_text: "Hello World",
        new_text: "Hello Everyone",
      },
      {} as any
    );

    expect(result.success).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^\uFEFF/),
      "utf-8"
    );
  });

  it("should have correct metadata", () => {
    expect(editFileTool.name).toBe("edit_file");
    expect(editFileTool.description).toContain("Edit a file");
    expect(editFileTool.security.level).toBe("write");
    expect(editFileTool.parameters.required).toContain("path");
    expect(editFileTool.parameters.required).toContain("old_text");
    expect(editFileTool.parameters.required).toContain("new_text");
  });
});
