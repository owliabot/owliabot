import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { streamLogs, matchesLevel, matchesGrep, type LogReaderOptions } from "../reader.js";

const TMP = join(tmpdir(), "owliabot-logs-test");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  try {
    unlinkSync(join(TMP, "test.log"));
  } catch {
    // ignore
  }
});

describe("matchesLevel", () => {
  it("matches case-insensitively", () => {
    expect(matchesLevel("2025-01-01 INFO starting", "info")).toBe(true);
    expect(matchesLevel("2025-01-01 INFO starting", "error")).toBe(false);
  });
});

describe("matchesGrep", () => {
  it("matches substring case-insensitively", () => {
    expect(matchesGrep("Gateway started on port 8787", "gateway")).toBe(true);
    expect(matchesGrep("Gateway started on port 8787", "shutdown")).toBe(false);
  });
});

describe("streamLogs - file source", () => {
  it("reads last N lines from a file", async () => {
    const filePath = join(TMP, "test.log");
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`);
    writeFileSync(filePath, lines.join("\n") + "\n");

    const opts: LogReaderOptions = {
      follow: false,
      lines: 3,
      source: { kind: "file", path: filePath },
    };

    const result: string[] = [];
    for await (const line of streamLogs(opts)) {
      result.push(line);
    }

    expect(result).toEqual(["line-7", "line-8", "line-9"]);
  });

  it("applies level filter", async () => {
    const filePath = join(TMP, "test.log");
    writeFileSync(
      filePath,
      "INFO hello\nDEBUG noisy\nERROR bad\nINFO world\n",
    );

    const result: string[] = [];
    for await (const line of streamLogs({
      follow: false,
      lines: 100,
      level: "error",
      source: { kind: "file", path: filePath },
    })) {
      result.push(line);
    }

    expect(result).toEqual(["ERROR bad"]);
  });

  it("applies grep filter", async () => {
    const filePath = join(TMP, "test.log");
    writeFileSync(filePath, "start gateway\nload config\ngateway ready\n");

    const result: string[] = [];
    for await (const line of streamLogs({
      follow: false,
      lines: 100,
      grep: "gateway",
      source: { kind: "file", path: filePath },
    })) {
      result.push(line);
    }

    expect(result).toEqual(["start gateway", "gateway ready"]);
  });

  it("combines level and grep filters", async () => {
    const filePath = join(TMP, "test.log");
    writeFileSync(
      filePath,
      "INFO gateway start\nERROR gateway crash\nERROR db fail\nINFO done\n",
    );

    const result: string[] = [];
    for await (const line of streamLogs({
      follow: false,
      lines: 100,
      level: "error",
      grep: "gateway",
      source: { kind: "file", path: filePath },
    })) {
      result.push(line);
    }

    expect(result).toEqual(["ERROR gateway crash"]);
  });
});

describe("streamLogs - process source", () => {
  it("reads from a process command", async () => {
    const result: string[] = [];
    for await (const line of streamLogs({
      follow: false,
      lines: 100,
      source: { kind: "process", command: ["echo", "hello world"] },
    })) {
      result.push(line);
    }

    expect(result).toEqual(["hello world"]);
  });
});
