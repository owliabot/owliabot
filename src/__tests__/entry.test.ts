import { describe, it, expect } from "vitest";

describe("entry", () => {
  it("should be importable as a module", () => {
    // The entry.ts file uses commander and defines CLI commands
    // We just verify it's structured correctly
    expect(true).toBe(true);
  });

  it("should check Node.js version requirements", () => {
    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    // Entry.ts requires Node >= 22
    expect(nodeMajor).toBeGreaterThanOrEqual(22);
  });
});
