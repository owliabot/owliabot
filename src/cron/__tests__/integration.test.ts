/**
 * Cron Integration Tests
 * P0/P1 priority tests for main and isolated job execution
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "../service.js";
import type { CronDeps, CronJob, CronEvent } from "../types.js";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("cron integration", () => {
  let testDir: string;
  let cronService: CronService;
  let mockDeps: CronDeps;
  let systemEvents: Array<{ text: string; agentId?: string | null }>;
  let heartbeatRequests: string[];
  let cronEvents: CronEvent[];
  let currentTime: number;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cron-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    systemEvents = [];
    heartbeatRequests = [];
    cronEvents = [];
    currentTime = Date.now();

    mockDeps = {
      cronEnabled: true,
      storePath: join(testDir, "jobs.json"),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      nowMs: () => currentTime,
      enqueueSystemEvent: (text, opts) => {
        systemEvents.push({ text, agentId: opts?.agentId });
      },
      requestHeartbeatNow: (opts) => {
        heartbeatRequests.push(opts.reason);
      },
      onEvent: (evt) => {
        cronEvents.push(evt);
      },
    };

    cronService = new CronService(mockDeps);
    await cronService.start();
  });

  afterEach(async () => {
    cronService.stop();
    await rm(testDir, { recursive: true, force: true });
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

      // Verify heartbeat requested
      expect(heartbeatRequests).toHaveLength(1);
      expect(heartbeatRequests[0]).toContain(job.id);

      // Verify events emitted
      const startedEvent = cronEvents.find(e => e.action === "started");
      const finishedEvent = cronEvents.find(e => e.action === "finished");
      expect(startedEvent).toBeDefined();
      expect(finishedEvent).toBeDefined();
      expect((finishedEvent as any).status).toBe("ok");
    });

    it("disables one-shot job after successful execution", async () => {
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
    });

    it("deletes one-shot job when deleteAfterRun is true", async () => {
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
      const removedEvent = cronEvents.find(e => e.action === "removed" && e.jobId === job.id);
      expect(removedEvent).toBeDefined();
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

    it("handles wakeMode=now with runHeartbeatOnce", async () => {
      let heartbeatRan = false;
      mockDeps.runHeartbeatOnce = async () => {
        heartbeatRan = true;
        return { status: "ran", reason: "test" };
      };

      // Recreate service with new deps
      cronService.stop();
      cronService = new CronService(mockDeps);
      await cronService.start();

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

      expect(heartbeatRan).toBe(true);
      expect(systemEvents[0].text).toBe("Wake immediately");
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
      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("skipped");
      expect(finishedEvent?.error).toContain("isolated");
    });

    it("executes isolated job with runIsolatedAgentJob configured", async () => {
      let isolatedJobRan = false;
      let receivedJob: CronJob | null = null;
      let receivedMessage = "";

      mockDeps.runIsolatedAgentJob = async (opts) => {
        isolatedJobRan = true;
        receivedJob = opts.job;
        receivedMessage = opts.message;
        return {
          status: "ok",
          summary: "Task completed successfully",
        };
      };

      // Recreate service with new deps
      cronService.stop();
      cronService = new CronService(mockDeps);
      await cronService.start();

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

      expect(isolatedJobRan).toBe(true);
      expect(receivedJob?.id).toBe(job.id);
      expect(receivedMessage).toBe("Process this request");

      // Verify success
      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("ok");
      expect(finishedEvent?.summary).toBe("Task completed successfully");
    });

    it("handles isolated job execution failure", async () => {
      mockDeps.runIsolatedAgentJob = async () => {
        return {
          status: "error",
          summary: "Agent failed",
          error: "Model timeout",
        };
      };

      cronService.stop();
      cronService = new CronService(mockDeps);
      await cronService.start();

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

      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("error");
      expect(finishedEvent?.error).toBe("Model timeout");
    });

    it("requests heartbeat after isolated job when wakeMode=now", async () => {
      mockDeps.runIsolatedAgentJob = async () => ({
        status: "ok",
        summary: "Done",
      });

      cronService.stop();
      cronService = new CronService(mockDeps);
      await cronService.start();

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

      // Verify heartbeat requested after isolated job
      expect(heartbeatRequests.some(r => r.includes(job.id))).toBe(true);
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
      cronService.stop();
      cronService = new CronService(mockDeps);
      await cronService.start();

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
      cronService.stop();
      cronService = new CronService(mockDeps);
      await cronService.start();

      const jobs = await cronService.list();
      const recovered = jobs.find(j => j.name === "Recovery Test");
      expect(recovered).toBeDefined();
      expect(recovered?.state.nextRunAtMs).toBe(originalNextRun);
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

    it("handles empty systemEvent text gracefully", async () => {
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

      const finishedEvent = cronEvents.find(
        e => e.action === "finished" && e.jobId === job.id
      ) as any;
      expect(finishedEvent?.status).toBe("skipped");
      expect(finishedEvent?.error).toContain("empty");
    });
  });
});
