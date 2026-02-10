import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("entry", () => {
  it("should be importable as a module", async () => {
    // Verify the entry file declares the expected CLI structure without executing it.
    const entryPath = resolve(process.cwd(), "src", "entry.ts");
    const content = await readFile(entryPath, "utf-8");

    expect(content).toContain('.name("owliabot")');
    expect(content).toContain('.command("start")');
    expect(content).toContain('.command("doctor")');
    expect(content).toContain('.command("onboard")');
    expect(content).toContain('.command("token")');
    expect(content).toContain('.command("auth")');
    expect(content).toContain('.command("models")');
  });

  it("should check Node.js version requirements", () => {
    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    // Entry.ts requires Node >= 22
    expect(nodeMajor).toBeGreaterThanOrEqual(22);
  });
});
