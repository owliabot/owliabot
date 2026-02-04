import { describe, it, expect, vi, beforeEach } from "vitest";
import { runIsolatedAgentJob } from "../run.js";
import type { CronJob } from "../../types.js";
import type { IsolatedAgentDeps } from "../types.js";

describe("runIsolatedAgentJob", () => {
  let mockDeps: IsolatedAgentDeps;

  beforeEach(() => {
    mockDeps = {
      runAgentTurn: vi.fn(async () => ({ output: "Agent response" })),
      sendMessage: vi.fn(async () => {}),
      getLastRoute: vi.fn(() => undefined),
      enqueueSystemEvent: vi.fn(),
    };
  });

  const baseJob: CronJob = {
    id: "job-123",
    name: "Test Job",
    enabled: true,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    schedule: { kind: "cron", expr: "* * * * *" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "Run this task" },
    state: {},
  };

  it("runs agent turn and returns ok", async () => {
    const result = await runIsolatedAgentJob(baseJob, mockDeps);

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Agent response");
    expect(mockDeps.runAgentTurn).toHaveBeenCalledWith(
      "cron:job-123",
      expect.stringContaining("Run this task"),
      expect.any(Object),
    );
  });

  it("posts summary to main session", async () => {
    await runIsolatedAgentJob(baseJob, mockDeps);

    expect(mockDeps.enqueueSystemEvent).toHaveBeenCalledWith(
      expect.stringContaining("(ok)"),
      { agentId: undefined },
    );
  });

  it("returns error when agent turn fails", async () => {
    mockDeps.runAgentTurn = vi.fn(async () => ({
      output: "",
      error: "Agent failed",
    }));

    const result = await runIsolatedAgentJob(baseJob, mockDeps);

    expect(result.status).toBe("error");
    expect(result.error).toBe("Agent failed");
  });

  it("returns error when agent turn throws", async () => {
    mockDeps.runAgentTurn = vi.fn(async () => {
      throw new Error("Network error");
    });

    const result = await runIsolatedAgentJob(baseJob, mockDeps);

    expect(result.status).toBe("error");
    expect(result.error).toContain("Network error");
  });

  it("skips non-agentTurn payload", async () => {
    const job: CronJob = {
      ...baseJob,
      payload: { kind: "systemEvent", text: "hi" },
    };

    const result = await runIsolatedAgentJob(job, mockDeps);

    expect(result.status).toBe("skipped");
    expect(mockDeps.runAgentTurn).not.toHaveBeenCalled();
  });

  it("delivers to channel when deliver is true", async () => {
    const job: CronJob = {
      ...baseJob,
      payload: {
        kind: "agentTurn",
        message: "test",
        deliver: true,
        channel: "telegram",
        to: "user-123",
      },
    };

    const result = await runIsolatedAgentJob(job, mockDeps);

    expect(result.status).toBe("ok");
    expect(mockDeps.sendMessage).toHaveBeenCalledWith(
      "telegram",
      "user-123",
      "Agent response",
    );
    expect(result.deliveryResult?.sent).toBe(true);
  });

  it("skips delivery for HEARTBEAT_OK output", async () => {
    mockDeps.runAgentTurn = vi.fn(async () => ({ output: "HEARTBEAT_OK" }));

    const job: CronJob = {
      ...baseJob,
      payload: {
        kind: "agentTurn",
        message: "test",
        deliver: true,
        channel: "telegram",
        to: "user-123",
      },
    };

    const result = await runIsolatedAgentJob(job, mockDeps);

    expect(result.status).toBe("ok");
    expect(mockDeps.sendMessage).not.toHaveBeenCalled();
    expect(result.deliveryResult?.sent).toBe(false);
    expect(result.deliveryResult?.error).toContain("skipped");
  });

  it("handles delivery failure in explicit mode", async () => {
    mockDeps.sendMessage = vi.fn(async () => {
      throw new Error("Send failed");
    });

    const job: CronJob = {
      ...baseJob,
      payload: {
        kind: "agentTurn",
        message: "test",
        deliver: true,
        channel: "telegram",
        to: "user-123",
      },
    };

    const result = await runIsolatedAgentJob(job, mockDeps);

    expect(result.status).toBe("error");
    expect(result.deliveryResult?.sent).toBe(false);
    expect(result.deliveryResult?.error).toContain("Send failed");
  });
});
