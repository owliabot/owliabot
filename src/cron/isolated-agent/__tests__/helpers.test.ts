import { describe, it, expect } from "vitest";
import {
  shouldSkipDelivery,
  truncateOutput,
  buildPostToMainMessage,
} from "../helpers.js";
import type { CronJob } from "../../types.js";
import type { IsolatedJobRunResult } from "../types.js";

describe("shouldSkipDelivery", () => {
  it("skips empty output", () => {
    expect(shouldSkipDelivery("")).toBe(true);
    expect(shouldSkipDelivery("   ")).toBe(true);
    expect(shouldSkipDelivery(undefined)).toBe(true);
  });

  it("skips HEARTBEAT_OK", () => {
    expect(shouldSkipDelivery("HEARTBEAT_OK")).toBe(true);
    expect(shouldSkipDelivery("HEARTBEAT_OK  ")).toBe(true);
    expect(shouldSkipDelivery("HEARTBEAT_OK\n")).toBe(true);
  });

  it("does not skip real content", () => {
    expect(shouldSkipDelivery("Hello world")).toBe(false);
    expect(shouldSkipDelivery("HEARTBEAT_OK but also some content")).toBe(false);
  });
});

describe("truncateOutput", () => {
  it("returns text unchanged if within limit", () => {
    expect(truncateOutput("hello", 10)).toBe("hello");
  });

  it("truncates with ellipsis", () => {
    expect(truncateOutput("hello world", 5)).toBe("hello…");
  });

  it("handles zero limit", () => {
    expect(truncateOutput("hello", 0)).toBe("");
  });
});

describe("buildPostToMainMessage", () => {
  const baseJob: CronJob = {
    id: "job-123",
    name: "Test Job",
    enabled: true,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    schedule: { kind: "cron", expr: "* * * * *" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "test" },
    state: {},
  };

  it("builds message with default prefix", () => {
    const result: IsolatedJobRunResult = { status: "ok", summary: "Done" };
    const msg = buildPostToMainMessage(baseJob, result);
    expect(msg).toContain("[cron:job-123 Test Job]");
    expect(msg).toContain("(ok)");
    expect(msg).toContain("Done");
  });

  it("uses custom prefix from isolation config", () => {
    const job: CronJob = {
      ...baseJob,
      isolation: { postToMainPrefix: "MyPrefix" },
    };
    const result: IsolatedJobRunResult = { status: "ok", summary: "Done" };
    const msg = buildPostToMainMessage(job, result);
    expect(msg).toContain("MyPrefix");
  });

  it("includes delivery info when present", () => {
    const result: IsolatedJobRunResult = {
      status: "ok",
      summary: "Done",
      deliveryResult: { sent: true, channel: "telegram", to: "12345" },
    };
    const msg = buildPostToMainMessage(baseJob, result);
    expect(msg).toContain("Delivered to telegram:12345");
  });

  it("includes full output when postToMainMode is full", () => {
    const job: CronJob = {
      ...baseJob,
      isolation: { postToMainMode: "full", postToMainMaxChars: 100 },
    };
    const result: IsolatedJobRunResult = {
      status: "ok",
      summary: "Summary",
      output: "Full output text here",
    };
    const msg = buildPostToMainMessage(job, result);
    expect(msg).toContain("Full output text here");
  });
});
