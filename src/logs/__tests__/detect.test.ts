import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), "owliabot-detect-test");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

describe("detectLogSource", () => {
  it("returns file source when --file points to an existing file", async () => {
    const filePath = join(TMP, "app.log");
    writeFileSync(filePath, "test\n");

    const { detectLogSource } = await import("../detect.js");
    const result = await detectLogSource({ file: filePath, container: "owliabot" });

    expect(result.source).toEqual({ kind: "file", path: filePath });

    unlinkSync(filePath);
  });

  it("returns hint when --file does not exist", async () => {
    const { detectLogSource } = await import("../detect.js");
    const result = await detectLogSource({
      file: "/nonexistent/path.log",
      container: "owliabot",
    });

    expect(result.source).toBeNull();
    expect(result.hint).toContain("not found");
  });
});
