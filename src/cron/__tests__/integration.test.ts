/**
 * Cron Integration Tests
 * P0/P1 priority tests for main and isolated job execution
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { CronService } from "../service.js";
import type { CronDeps, CronJob, CronEvent } from "../types.js";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use fake timers to prevent real timer firing and flakiness
beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

describe("cron integration", () => {
  let testDir: string;
  let cronService: CronService;
  let mockDeps: CronDeps;
  let systemEvents: Array<{ text: string; agentId?: string | null }>;
  let heartbeatRequests: string[];
  let cronEvents: CronEvent[];
  let currentTime: number;

  // Helper to restart service with new deps
  async function restartWithDeps(overrides: Partial<CronDeps> = {}): Promise<void> {
    cronService.stop();
    mockDeps = { ...mockDeps, ...overrides };
    cronService = new CronService(mockDeps);
    await cronService.start();
  }

  beforeEach(async () => {
    // Use a unique test directory
    const now = Date.now();
    testDir = join(tmpdir(), `cron-test-${now}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    systemEvents = [];
    heartbeatRequests = [];
    cronEvents = [];
    currentTime = now;

    mockDeps = {
      cronEnabled: true,
      storePath: join(testDir, "jobs.json"),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      nowMs: () => currentTime,
      enqueueSystemEvent: vi.fn((text, opts) => {
        systemEvents.push({ text, agentId: opts?.agentId });
      }),
      requestHeartbeatNow: vi.fn((opts) => {
        heartbeatRequests.push(opts.reason);
      }),
      onEvent: vi.fn((evt) => {
        cronEvents.push(evt);
      }),
    };

    cronService = new CronService(mockDeps);
    await cronService.start();
  });

  afterEach(async () => {
    cronService.stop();
    vi.clearAllTimers();
    // maxRetries handles race conditions where files are still being written
    await rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  describe("main session jobs (systemEvent)", () => {
    it("creates and stores a main session job", async () => {
      const job = await cronService.add({
        name: "Test Main Job",
        schedule: { kind: "at", atMs: currentTime + 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Hello from cron" },
        enabled: true,
      });

      expect(job.id).toBeDefined();
      expect(job.name).toBe("Test Main Job");
      expect(job.sessionTarget).toBe("main");
      expect(job.payload.kind).toBe("systemEvent");
      expect(job.state.nextRunAtMs).toBe(currentTime + 60_000);

      // Verify added event emitted
      const addedEvents = cronEvents.filter(e => e.action === "added" && e.jobId === job.id);
      expect(addedEvents).toHaveLength(1);

      // Verify persisted
      const jobs = await cronService.list();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe(job.id);
    });

    it("executes main job and enqueues system event", async () => {
      const job = await cronService.add({
        name: "Execute Test",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Scheduled message" },
        enabled: true,
      });

      // Advance time past schedule
      currentTime += 200;

      // Force run the job
      const result = await cronService.run(job.id, "force");
      expect(result.ran).toBe(true);

      // Verify system event enqueued
      expect(systemEvents).toHaveLength(1);
      expect(systemEvents[0].text).toBe("Scheduled message");

      // Verify heartbeat requested with exact reason
      expect(heartbeatRequests).toHaveLength(1);
      expect(heartbeatRequests[0]).toBe(`cron:${job.id}`);

      // Verify events emitted with correct structure
      const startedEvents = cronEvents.filter(e => e.action === "started" && e.jobId === job.id);
      expect(startedEvents).toHaveLength(1);

      const finishedEvents = cronEvents.filter(e => e.action === "finished" && e.jobId === job.id) as any[];
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0]).toMatchObject({
        jobId: job.id,
        action: "finished",
        status: "ok",
      });
      expect(typeof finishedEvents[0].durationMs).toBe("number");
    });

    it("disables one-shot at job after successful execution", async () => {
      const job = await cronService.add({
        name: "One-shot Test",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Once only" },
        enabled: true,
        deleteAfterRun: false,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      // Verify job disabled
      const jobs = await cronService.list({ includeDisabled: true });
      const updated = jobs.find(j => j.id === job.id);
      expect(updated?.enabled).toBe(false);
      expect(updated?.state.lastStatus).toBe("ok");
      expect(updated?.state.nextRunAtMs).toBeUndefined();
    });

    it("deletes one-shot at job when deleteAfterRun is true", async () => {
      const job = await cronService.add({
        name: "Delete After Run",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Delete me" },
        enabled: true,
        deleteAfterRun: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      // Verify job deleted
      const jobs = await cronService.list({ includeDisabled: true });
      expect(jobs.find(j => j.id === job.id)).toBeUndefined();

      // Verify removed event emitted
      const removedEvents = cronEvents.filter(e => e.action === "removed" && e.jobId === job.id);
      expect(removedEvents).toHaveLength(1);
    });

    it("does NOT disable/delete one-shot at job on skipped status", async () => {
      const job = await cronService.add({
        name: "Skipped One-shot",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "   " }, // whitespace only -> skipped
        enabled: true,
        deleteAfterRun: true, // even with deleteAfterRun, should NOT delete on skip
      });

      const originalAtMs = job.schedule.kind === "at" ? job.schedule.atMs : 0;

      currentTime += 200;
      await cronService.run(job.id, "force");

      // Verify job still exists and still enabled
      const jobs = await cronService.list({ includeDisabled: true });
      const updated = jobs.find(j => j.id === job.id);
      expect(updated).toBeDefined();
      expect(updated?.enabled).toBe(true);
      expect(updated?.state.lastStatus).toBe("skipped");
      // nextRunAtMs should still be the original atMs (still due)
      expect(updated?.state.nextRunAtMs).toBe(originalAtMs);
    });

    it("reschedules recurring cron job after execution", async () => {
      const job = await cronService.add({
        name: "Recurring Cron",
        schedule: { kind: "cron", expr: "* * * * *" }, // every minute
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Recurring" },
        enabled: true,
      });

      const initialNextRun = job.state.nextRunAtMs;
      expect(initialNextRun).toBeDefined();

      // Force run
      await cronService.run(job.id, "force");

      // Verify nextRunAtMs updated to a future time
      const jobs = await cronService.list();
      const updated = jobs.find(j => j.id === job.id);
      expect(updated?.state.nextRunAtMs).toBeGreaterThan(currentTime);
      expect(updated?.enabled).toBe(true);
    });

    it("handles wakeMode=now with runHeartbeatOnce (basic success)", async () => {
      const runHeartbeatOnceMock = vi.fn(async () => ({
        status: "ran" as const,
        reason: "ok",
      }));
      
      await restartWithDeps({ runHeartbeatOnce: runHeartbeatOnceMock });

      const job = await cronService.add({
        name: "Wake Now Test",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "Wake immediately" },
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      expect(runHeartbeatOnceMock).toHaveBeenCalled();
      expect(systemEvents[0].text).toBe("Wake immediately");

      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("ok");
    });

    it("wakeMode=now retries runHeartbeatOnce on requests-in-flight", async () => {
      let callCount = 0;
      const runHeartbeatOnceMock = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return { status: "skipped" as const, reason: "requests-in-flight" };
        }
        return { status: "ran" as const, reason: "ok" };
      });

      await restartWithDeps({ runHeartbeatOnce: runHeartbeatOnceMock });

      const job = await cronService.add({
        name: "Retry Test",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "Retry message" },
        enabled: true,
      });

      currentTime += 200;
      
      // Run the job - it will retry internally
      const runPromise = cronService.run(job.id, "force");
      
      // Advance fake timers to allow retry delays (250ms each)
      await vi.advanceTimersByTimeAsync(1000);
      
      await runPromise;

      // Should have been called multiple times due to retry
      expect(runHeartbeatOnceMock.mock.calls.length).toBeGreaterThanOrEqual(3);

      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("ok");
    });

    it("wakeMode=now times out after 2 minutes of requests-in-flight", async () => {
      const runHeartbeatOnceMock = vi.fn(async () => ({
        status: "skipped" as const,
        reason: "requests-in-flight",
      }));

      await restartWithDeps({ runHeartbeatOnce: runHeartbeatOnceMock });

      const job = await cronService.add({
        name: "Timeout Test",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "Timeout message" },
        enabled: true,
      });

      currentTime += 200;

      const runPromise = cronService.run(job.id, "force");

      // Advance time past 2 minute timeout (with buffer)
      for (let i = 0; i < 500; i++) {
        currentTime += 300; // advance mock time
        await vi.advanceTimersByTimeAsync(300);
      }

      await runPromise;

      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("skipped");
      expect(finishedEvent?.error).toContain("timeout");
    });
  });

  describe("isolated session jobs (agentTurn)", () => {
    it("creates and stores an isolated session job", async () => {
      const job = await cronService.add({
        name: "Test Isolated Job",
        schedule: { kind: "at", atMs: currentTime + 60_000 },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: {
          kind: "agentTurn",
          message: "Analyze this data",
          model: "anthropic/claude-sonnet",
        },
        enabled: true,
      });

      expect(job.id).toBeDefined();
      expect(job.sessionTarget).toBe("isolated");
      expect(job.payload.kind).toBe("agentTurn");
      if (job.payload.kind === "agentTurn") {
        expect(job.payload.message).toBe("Analyze this data");
        expect(job.payload.model).toBe("anthropic/claude-sonnet");
      }
    });

    it("skips isolated job when runIsolatedAgentJob not configured", async () => {
      const job = await cronService.add({
        name: "Isolated No Runner",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "Test message" },
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      // Verify job marked as skipped
      const finishedEvents = cronEvents.filter(
        e => e.action === "finished" && e.jobId === job.id
      ) as any[];
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].status).toBe("skipped");
      expect(finishedEvents[0].error).toContain("isolated");
    });

    it("executes isolated job with runIsolatedAgentJob configured", async () => {
      let receivedJob: CronJob | null = null;
      let receivedMessage = "";

      const runIsolatedMock = vi.fn(async (opts: { job: CronJob; message: string }) => {
        receivedJob = opts.job;
        receivedMessage = opts.message;
        return {
          status: "ok" as const,
          summary: "Task completed successfully",
        };
      });

      await restartWithDeps({ runIsolatedAgentJob: runIsolatedMock });

      const job = await cronService.add({
        name: "Isolated With Runner",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: {
          kind: "agentTurn",
          message: "Process this request",
          model: "anthropic/claude-opus",
        },
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      expect(runIsolatedMock).toHaveBeenCalledTimes(1);
      expect(receivedJob?.id).toBe(job.id);
      expect(receivedMessage).toBe("Process this request");

      // Verify success
      const finishedEvents = cronEvents.filter(
        e => e.action === "finished" && e.jobId === job.id
      ) as any[];
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].status).toBe("ok");
      expect(finishedEvents[0].summary).toBe("Task completed successfully");
    });

    it("handles isolated job execution failure", async () => {
      const runIsolatedMock = vi.fn(async () => ({
        status: "error" as const,
        summary: "Agent failed",
        error: "Model timeout",
      }));

      await restartWithDeps({ runIsolatedAgentJob: runIsolatedMock });

      const job = await cronService.add({
        name: "Isolated Failure",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "This will fail" },
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      const finishedEvents = cronEvents.filter(
        e => e.action === "finished" && e.jobId === job.id
      ) as any[];
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].status).toBe("error");
      expect(finishedEvents[0].error).toBe("Model timeout");
    });

    it("requests heartbeat after isolated job with wakeMode=now using correct reason", async () => {
      const runIsolatedMock = vi.fn(async () => ({
        status: "ok" as const,
        summary: "Done",
      }));

      await restartWithDeps({ runIsolatedAgentJob: runIsolatedMock });

      const job = await cronService.add({
        name: "Isolated Wake Now",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Wake after" },
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      // Verify heartbeat requested with exact reason suffix :post
      expect(heartbeatRequests.some(r => r === `cron:${job.id}:post`)).toBe(true);
    });
  });

  describe("schedule types", () => {
    it("computes nextRunAtMs for 'at' schedule", async () => {
      const futureTime = currentTime + 300_000; // 5 minutes
      const job = await cronService.add({
        name: "At Schedule",
        schedule: { kind: "at", atMs: futureTime },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "At test" },
        enabled: true,
      });

      expect(job.state.nextRunAtMs).toBe(futureTime);
    });

    it("computes nextRunAtMs for 'every' schedule", async () => {
      const interval = 60_000; // 1 minute
      const job = await cronService.add({
        name: "Every Schedule",
        schedule: { kind: "every", everyMs: interval },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Every test" },
        enabled: true,
      });

      expect(job.state.nextRunAtMs).toBeDefined();
      expect(job.state.nextRunAtMs!).toBeGreaterThanOrEqual(currentTime);
      expect(job.state.nextRunAtMs!).toBeLessThanOrEqual(currentTime + interval);
    });

    it("computes nextRunAtMs for 'every' schedule with anchorMs", async () => {
      const anchor = currentTime - 30_000; // 30 seconds ago
      const interval = 60_000; // 1 minute
      const job = await cronService.add({
        name: "Every With Anchor",
        schedule: { kind: "every", everyMs: interval, anchorMs: anchor },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Anchored test" },
        enabled: true,
      });

      expect(job.state.nextRunAtMs).toBeDefined();
      // Should be at anchor + N*interval where result > currentTime
      const nextRun = job.state.nextRunAtMs!;
      expect((nextRun - anchor) % interval).toBe(0);
      expect(nextRun).toBeGreaterThan(currentTime);
    });

    it("computes nextRunAtMs for 'cron' schedule", async () => {
      const job = await cronService.add({
        name: "Cron Schedule",
        schedule: { kind: "cron", expr: "0 * * * *" }, // every hour
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Cron test" },
        enabled: true,
      });

      expect(job.state.nextRunAtMs).toBeDefined();
      expect(job.state.nextRunAtMs!).toBeGreaterThan(currentTime);
    });

    it("computes nextRunAtMs for 'cron' schedule with timezone", async () => {
      const job = await cronService.add({
        name: "Cron With TZ",
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "America/New_York" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "TZ cron test" },
        enabled: true,
      });

      expect(job.state.nextRunAtMs).toBeDefined();
      expect(job.state.nextRunAtMs!).toBeGreaterThan(currentTime);
    });
  });

  describe("run mode behavior", () => {
    it("run(mode=due) returns not-due when job is not due", async () => {
      const job = await cronService.add({
        name: "Future Job",
        schedule: { kind: "at", atMs: currentTime + 3600_000 }, // 1 hour in future
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Future" },
        enabled: true,
      });

      const result = await cronService.run(job.id, "due");
      expect(result.ran).toBe(false);
      expect(result.reason).toBe("not-due");

      // Verify no side effects
      expect(systemEvents).toHaveLength(0);
      expect(cronEvents.filter(e => e.action === "started")).toHaveLength(0);
    });

    it("run(mode=force) runs even when job is not due", async () => {
      const job = await cronService.add({
        name: "Force Future Job",
        schedule: { kind: "at", atMs: currentTime + 3600_000 }, // 1 hour in future
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Forced" },
        enabled: true,
      });

      const result = await cronService.run(job.id, "force");
      expect(result.ran).toBe(true);

      // Verify it actually ran
      expect(systemEvents).toHaveLength(1);
      expect(systemEvents[0].text).toBe("Forced");
    });

    it("run(mode=force) runs even on disabled job", async () => {
      const job = await cronService.add({
        name: "Disabled Job",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Disabled but forced" },
        enabled: false, // disabled
      });

      const result = await cronService.run(job.id, "force");
      expect(result.ran).toBe(true);
      expect(systemEvents[0].text).toBe("Disabled but forced");
    });
  });

  describe("persistence and recovery", () => {
    it("persists jobs to store file", async () => {
      await cronService.add({
        name: "Persist Test",
        schedule: { kind: "at", atMs: currentTime + 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Persist me" },
        enabled: true,
      });

      // Stop and recreate service
      await restartWithDeps({});

      // Verify job loaded
      const jobs = await cronService.list();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("Persist Test");
    });

    it("recovers job state after restart", async () => {
      const job = await cronService.add({
        name: "Recovery Test",
        schedule: { kind: "cron", expr: "* * * * *" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Recover me" },
        enabled: true,
      });

      const originalNextRun = job.state.nextRunAtMs;

      // Stop and recreate
      await restartWithDeps({});

      const jobs = await cronService.list();
      const recovered = jobs.find(j => j.name === "Recovery Test");
      expect(recovered).toBeDefined();
      expect(recovered?.state.nextRunAtMs).toBe(originalNextRun);
    });

    it("clears stuck runningAtMs on startup when older than 2 hours", async () => {
      // Use a separate store path to avoid cache issues
      const stuckStorePath = join(testDir, "stuck-jobs.json");
      const stuckTime = currentTime - 3 * 60 * 60 * 1000; // 3 hours ago

      // Create a stuck job directly in the store file
      const stuckJob = {
        id: "stuck-job-123",
        name: "Stuck Job",
        enabled: true,
        createdAtMs: currentTime - 86400000,
        updatedAtMs: currentTime - 86400000,
        schedule: { kind: "cron", expr: "* * * * *" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Stuck" },
        state: {
          runningAtMs: stuckTime, // stuck for 3 hours
          nextRunAtMs: currentTime + 60000,
        },
      };
      const storeData = { version: 1, jobs: [stuckJob] };
      await writeFile(stuckStorePath, JSON.stringify(storeData));

      // Create a fresh warn mock to track the warning
      const warnMock = vi.fn();
      const stuckDeps: CronDeps = {
        ...mockDeps,
        storePath: stuckStorePath,
        log: {
          info: vi.fn(),
          warn: warnMock,
          error: vi.fn(),
        },
      };

      // Start service with the stuck store
      const stuckService = new CronService(stuckDeps);
      await stuckService.start();

      // Verify runningAtMs was cleared
      const jobs = await stuckService.list({ includeDisabled: true });
      const recovered = jobs.find(j => j.id === "stuck-job-123");
      expect(recovered).toBeDefined();
      expect(recovered?.state.runningAtMs).toBeUndefined();

      // Verify warning was logged about stuck job
      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "stuck-job-123" }),
        expect.stringContaining("stuck"),
      );

      stuckService.stop();
    });
  });

  describe("job management", () => {
    it("updates job schedule and recalculates nextRunAtMs", async () => {
      const job = await cronService.add({
        name: "Update Test",
        schedule: { kind: "at", atMs: currentTime + 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Update me" },
        enabled: true,
      });

      const newTime = currentTime + 120_000;
      const updated = await cronService.update(job.id, {
        schedule: { kind: "at", atMs: newTime },
      });

      expect(updated.state.nextRunAtMs).toBe(newTime);

      // Verify updated event emitted
      const updatedEvents = cronEvents.filter(e => e.action === "updated" && e.jobId === job.id);
      expect(updatedEvents).toHaveLength(1);
    });

    it("disables job and clears nextRunAtMs", async () => {
      const job = await cronService.add({
        name: "Disable Test",
        schedule: { kind: "cron", expr: "* * * * *" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Disable me" },
        enabled: true,
      });

      expect(job.state.nextRunAtMs).toBeDefined();

      const updated = await cronService.update(job.id, { enabled: false });
      expect(updated.enabled).toBe(false);
      expect(updated.state.nextRunAtMs).toBeUndefined();
    });

    it("removes job and emits event", async () => {
      const job = await cronService.add({
        name: "Remove Test",
        schedule: { kind: "at", atMs: currentTime + 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Remove me" },
        enabled: true,
      });

      const result = await cronService.remove(job.id);
      expect(result.removed).toBe(true);

      const jobs = await cronService.list({ includeDisabled: true });
      expect(jobs.find(j => j.id === job.id)).toBeUndefined();

      // Verify removed event emitted
      const removedEvents = cronEvents.filter(e => e.action === "removed" && e.jobId === job.id);
      expect(removedEvents).toHaveLength(1);
    });
  });

  describe("run history", () => {
    it("records run history after execution", async () => {
      const job = await cronService.add({
        name: "History Test",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "Track history" },
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      // Check run history
      const history = await cronService.runs(job.id);
      expect(history.length).toBeGreaterThanOrEqual(1);

      const lastRun = history[history.length - 1];
      expect(lastRun.jobId).toBe(job.id);
      expect(lastRun.status).toBe("ok");
      expect(lastRun.action).toBe("finished");
      expect(typeof lastRun.durationMs).toBe("number");
    });
  });

  describe("error handling", () => {
    it("validates sessionTarget/payload consistency at creation", async () => {
      // main with agentTurn should fail at creation time
      await expect(
        cronService.add({
          name: "Invalid Combo",
          schedule: { kind: "at", atMs: currentTime + 100 },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "agentTurn", message: "Wrong payload" } as any,
          enabled: true,
        })
      ).rejects.toThrow('main cron jobs require payload.kind="systemEvent"');

      // isolated with systemEvent should also fail
      await expect(
        cronService.add({
          name: "Invalid Combo 2",
          schedule: { kind: "at", atMs: currentTime + 100 },
          sessionTarget: "isolated",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "Wrong payload" } as any,
          enabled: true,
        })
      ).rejects.toThrow('isolated cron jobs require payload.kind="agentTurn"');
    });

    it("handles empty systemEvent text gracefully (skipped)", async () => {
      const job = await cronService.add({
        name: "Empty Text",
        schedule: { kind: "at", atMs: currentTime + 100 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "   " }, // whitespace only
        enabled: true,
      });

      currentTime += 200;
      await cronService.run(job.id, "force");

      const finishedEvents = cronEvents.filter(
        e => e.action === "finished" && e.jobId === job.id
      ) as any[];
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].status).toBe("skipped");
      expect(finishedEvents[0].error).toContain("empty");
    });
  });
});
