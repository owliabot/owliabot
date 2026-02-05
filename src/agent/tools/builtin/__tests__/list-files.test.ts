import { describe, it, expect, vi, beforeEach } from "vitest";
import { createListFilesTool } from "../list-files.js";
import { readdir, stat } from "node:fs/promises";

vi.mock("node:fs/promises");

describe("list-files tool", () => {
  const workspacePath = "/test/workspace";
  let listFilesTool: ReturnType<typeof createListFilesTool>;

  beforeEach(() => {
    vi.resetAllMocks();
    listFilesTool = createListFilesTool({ workspace: workspacePath });
  });

  it("should list files and directories", async () => {
    vi.mocked(readdir).mockResolvedValue(["file1.txt", "dir1", ".hidden"] as any);
    vi.mocked(stat)
      .mockResolvedValueOnce({ isDirectory: () => false } as any)
      .mockResolvedValueOnce({ isDirectory: () => true } as any)
      .mockResolvedValueOnce({ isDirectory: () => false } as any);

    const result = await listFilesTool.execute({}, {} as any);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as any;
    expect(data.entries).toHaveLength(2); // .hidden should be skipped
    expect(data.entries).toEqual([
      { name: "dir1", type: "dir" },
      { name: "file1.txt", type: "file" },
    ]);
  });

  it("should list files in subdirectory", async () => {
    vi.mocked(readdir).mockResolvedValue(["sub1.txt", "sub2.txt"] as any);
    vi.mocked(stat)
      .mockResolvedValueOnce({ isDirectory: () => false } as any)
      .mockResolvedValueOnce({ isDirectory: () => false } as any);

    const result = await listFilesTool.execute(
      { path: "memory" },
      {} as any
    );

    expect(result.success).toBe(true);
    expect(readdir).toHaveBeenCalledWith(expect.stringContaining("memory"));
  });

  it("should reject paths with ..", async () => {
    const result = await listFilesTool.execute(
      { path: "../etc" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid path");
  });

  it("should reject absolute paths", async () => {
    const result = await listFilesTool.execute(
      { path: "/etc" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid path");
  });

  it("should return error when directory not found", async () => {
    const error: any = new Error("ENOENT");
    error.code = "ENOENT";
    vi.mocked(readdir).mockRejectedValue(error);

    const result = await listFilesTool.execute(
      { path: "missing" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Directory not found");
  });

  it("should surface stat permission errors", async () => {
    vi.mocked(readdir).mockResolvedValue(["secret.txt"] as any);
    const error: any = new Error("EACCES");
    error.code = "EACCES";
    vi.mocked(stat).mockImplementationOnce(() => {
      throw error;
    });

    await expect(listFilesTool.execute({}, {} as any)).rejects.toThrow("EACCES");
  });

  it("should sort directories before files", async () => {
    vi.mocked(readdir).mockResolvedValue(["file1.txt", "dirA", "file2.txt", "dirB"] as any);
    // Provide consistent mock implementation per file
    vi.mocked(stat).mockImplementation(async (path: any) => {
      const name = path.split("/").pop();
      return { isDirectory: () => name.startsWith("dir") } as any;
    });

    const result = await listFilesTool.execute({}, {} as any);

    const entries = (result.data as any).entries;
    expect(entries[0].type).toBe("dir");
    expect(entries[1].type).toBe("dir");
    expect(entries[2].type).toBe("file");
    expect(entries[3].type).toBe("file");
  });

  it("should skip hidden files", async () => {
    vi.mocked(readdir).mockResolvedValue([".git", ".hidden", "visible.txt"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as any);

    const result = await listFilesTool.execute({}, {} as any);

    const entries = (result.data as any).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("visible.txt");
  });

  it("should have correct metadata", () => {
    expect(listFilesTool.name).toBe("list_files");
    expect(listFilesTool.description).toContain("List files");
    expect(listFilesTool.security.level).toBe("read");
  });
});
