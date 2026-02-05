import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryGetTool } from "./memory-get.js";

describe("memory_get tool security boundary", () => {
  it("allows reading MEMORY.md and memory/**/*.md, blocks other workspace files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-memget-"));

    // Allowed files
    await writeFile(join(dir, "MEMORY.md"), "line1\nline2\nline3", "utf-8");
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(join(dir, "memory", "a.md"), "a1\na2\na3", "utf-8");

    // Disallowed: outside allowed roots but still inside workspace
    await writeFile(join(dir, "NOTES.md"), "nope", "utf-8");

    // Disallowed: symlink within allowed root (file)
    const target = join(dir, "MEMORY.md");
    const link = join(dir, "memory", "link.md");
    await symlink(target, link);

    const tool = createMemoryGetTool({ workspace: dir });

    // Allowed: MEMORY.md
    const ok1 = await tool.execute({ path: "MEMORY.md", from_line: 1, num_lines: 2 }, {} as any);
    expect(ok1.success).toBe(true);
    expect((ok1 as any).data.content).toContain("line1");

    // Allowed: memory/a.md
    const ok2 = await tool.execute({ path: "memory/a.md", from_line: 2, num_lines: 2 }, {} as any);
    expect(ok2.success).toBe(true);
    expect((ok2 as any).data.content).toContain("a2");

    // Blocked: NOTES.md
    const bad1 = await tool.execute({ path: "NOTES.md" }, {} as any);
    expect(bad1.success).toBe(false);
    expect((bad1 as any).error).toBe("path required");

    // Blocked: traversal
    const bad2 = await tool.execute({ path: "../MEMORY.md" }, {} as any);
    expect(bad2.success).toBe(false);
    expect((bad2 as any).error).toBe("path required");

    // Blocked: non-md
    const bad3 = await tool.execute({ path: "memory/a.txt" }, {} as any);
    expect(bad3.success).toBe(false);
    expect((bad3 as any).error).toBe("path required");

    // Blocked: symlink file
    const bad4 = await tool.execute({ path: "memory/link.md" }, {} as any);
    expect(bad4.success).toBe(false);
    expect((bad4 as any).error).toBe("path required");
  });

  it("blocks symlinked memory/ directory that points outside the workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "owliabot-memget-"));
    const outside = await mkdtemp(join(tmpdir(), "owliabot-memget-outside-"));

    await writeFile(join(outside, "secret.md"), "SECRET", "utf-8");

    // Replace workspace memory/ dir with a symlink to outside
    await mkdir(join(dir, "memory"), { recursive: true });
    await rm(join(dir, "memory"), { recursive: true, force: true });
    await symlink(outside, join(dir, "memory"));

    const tool = createMemoryGetTool({ workspace: dir });

    const res = await tool.execute({ path: "memory/secret.md" }, {} as any);
    expect(res.success).toBe(false);
    expect((res as any).error).toBe("path required");
  });
});
