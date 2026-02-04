import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { createCronServiceState } from "../state.js";
import { armTimer, executeJob, onTimer, stopTimer } from "../timer.js";
import type { CronJob } from "../../types.js";
import { resolveCronRunLogPath } from "../../run-log.js";

function tmpStorePath(): string {
  return path.join(
    os.tmpdir(),
    `owliabot-cron-timer-${process.pid}-${Math.random().toString(16).slice(2)}`,
    "jobs.json",
  );
}

describe("cron/service/timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("armTimer schedules a single timeout for the next wake and unrefs", async () => {
    const storePath = tmpStorePath();

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => 1000,
    });

    // Fake store with one enabled job.
    const job: CronJob = {
      id: "j1",
      name: "job",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 1000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hi" },
      state: { nextRunAtMs: 6000 },
    };
    state.store = { version: 1, jobs: [job] };

    const spy = vi.spyOn(globalThis, "setTimeout");
    armTimer(state);

    expect(state.timer).not.toBeNull();
    expect(spy).toHaveBeenCalled();
    const delay = (spy.mock.calls[0] as any[])[1];
    expect(delay).toBe(5000);

    stopTimer(state);
    spy.mockRestore();
  });

  it("armTimer clamps very large delays to 2^31-1", () => {
    const storePath = tmpStorePath();

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => 0,
    });

    state.store = {
      version: 1,
      jobs: [
        {
          id: "j1",
          name: "job",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 1000 },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "hi" },
          state: { nextRunAtMs: 2 ** 31 + 1000 },
        },
      ],
    };

    const spy = vi.spyOn(globalThis, "setTimeout");
    armTimer(state);

    const delay = (spy.mock.calls[0] as any[])[1];
    expect(delay).toBe(2 ** 31 - 1);

    stopTimer(state);
    spy.mockRestore();
  });

  it("executeJob runs main jobs, requests heartbeat, and appends run log", async () => {
    const storePath = tmpStorePath();

    const enqueueSystemEvent = vi.fn();
    const requestHeartbeatNow = vi.fn();
    let now = 1000;

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent,
      requestHeartbeatNow,
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => now,
    });

    const job: CronJob = {
      id: "j1",
      name: "job",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 1000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
      state: { nextRunAtMs: 1000 },
    };

    state.store = { version: 1, jobs: [job] };

    await executeJob(state, job, now, { forced: false });

    expect(enqueueSystemEvent).toHaveBeenCalledWith("hello", { agentId: undefined });
    expect(requestHeartbeatNow).toHaveBeenCalledWith({ reason: "cron:j1" });

    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.lastRunAtMs).toBe(1000);

    const logPath = resolveCronRunLogPath({ storePath, jobId: "j1" });
    const raw = await fs.readFile(logPath, "utf-8");
    expect(raw).toContain('"jobId":"j1"');
    expect(raw).toContain('"status":"ok"');
  });

  it("onTimer executes due jobs sequentially", async () => {
    const storePath = tmpStorePath();

    const enqueueSystemEvent = vi.fn();
    const requestHeartbeatNow = vi.fn();
    let now = 10_000;

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent,
      requestHeartbeatNow,
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => now,
    });

    const j1: CronJob = {
      id: "j1",
      name: "j1",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 1000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "a" },
      state: { nextRunAtMs: 9000 },
    };

    const j2: CronJob = {
      id: "j2",
      name: "j2",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 1000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "b" },
      state: { nextRunAtMs: 8000 },
    };

    state.store = { version: 1, jobs: [j1, j2] };

    await onTimer(state);

    expect(enqueueSystemEvent).toHaveBeenCalledTimes(2);
    expect(enqueueSystemEvent.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(j1.state.lastStatus).toBe("ok");
    expect(j2.state.lastStatus).toBe("ok");
  });
});
