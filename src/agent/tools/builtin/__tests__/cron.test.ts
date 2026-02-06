import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCronTool } from "../cron.js";
import type { CronService } from "../../../../cron/service.js";
import type { ToolContext } from "../../interface.js";

describe("cron tool", () => {
  let mockCronService: CronService;
  let tool: ReturnType<typeof createCronTool>;
  const mockCtx: ToolContext = {
    sessionKey: "test",
    agentId: "test",
    config: {},
  };

  beforeEach(() => {
    mockCronService = {
      start: vi.fn(),
      stop: vi.fn(),
      status: vi.fn(async () => ({
        enabled: true,
        storePath: "/test/cron/jobs.json",
        jobs: 2,
        nextWakeAtMs: Date.now() + 60000,
      })),
      list: vi.fn(async () => [
        {
          id: "job-1",
          name: "Test Job",
          enabled: true,
          createdAtMs: 1000,
          updatedAtMs: 1000,
          schedule: { kind: "cron", expr: "* * * * *" },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "test" },
          state: {},
        },
      ]),
      add: vi.fn(async (input) => ({
        id: "new-job",
        ...input,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        state: {},
      })),
      update: vi.fn(async (id, patch) => ({
        id,
        name: patch.name ?? "Test Job",
        enabled: patch.enabled ?? true,
        createdAtMs: 1000,
        updatedAtMs: Date.now(),
        schedule: { kind: "cron", expr: "* * * * *" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "test" },
        state: {},
      })),
      remove: vi.fn(async () => ({ ok: true, removed: true })),
      run: vi.fn(async () => ({ ok: true, ran: true })),
      wake: vi.fn(() => ({ ok: true })),
      runs: vi.fn(async () => []),
    } as unknown as CronService;

    tool = createCronTool({ cronService: mockCronService });
  });

  it("handles status action", async () => {
    const result = await tool.execute({ action: "status" }, mockCtx);
    expect(result.success).toBe(true);
    expect(mockCronService.status).toHaveBeenCalled();
  });

  it("handles list action", async () => {
    const result = await tool.execute({ action: "list" }, mockCtx);
    expect(result.success).toBe(true);
    expect(mockCronService.list).toHaveBeenCalledWith({ includeDisabled: undefined });
  });

  it("handles list with includeDisabled", async () => {
    await tool.execute({ action: "list", includeDisabled: true }, mockCtx);
    expect(mockCronService.list).toHaveBeenCalledWith({ includeDisabled: true });
  });

  it("handles add action", async () => {
    const result = await tool.execute(
      {
        action: "add",
        job: {
          name: "New Job",
          schedule: { kind: "cron", expr: "0 * * * *" },
          payload: { kind: "systemEvent", text: "hello" },
        },
      },
      mockCtx,
    );
    expect(result.success).toBe(true);
    expect(mockCronService.add).toHaveBeenCalled();
  });

  it("requires job for add action", async () => {
    const result = await tool.execute({ action: "add" }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("job object required");
  });

  it("handles update action", async () => {
    const result = await tool.execute(
      {
        action: "update",
        jobId: "job-1",
        patch: { name: "Updated Job" },
      },
      mockCtx,
    );
    expect(result.success).toBe(true);
    expect(mockCronService.update).toHaveBeenCalledWith("job-1", expect.any(Object));
  });

  it("allows partial payload update patches (e.g., deliver only)", async () => {
    const result = await tool.execute(
      {
        action: "update",
        jobId: "job-1",
        patch: {
          payload: {
            kind: "agentTurn",
            deliver: true,
          },
        },
      },
      mockCtx,
    );

    expect(result.success).toBe(true);

    const patchArg = (mockCronService.update as any).mock.calls[0][1];
    expect(patchArg.payload).toMatchObject({ kind: "agentTurn", deliver: true });
    expect(patchArg.payload).not.toHaveProperty("message");
  });

  it("rejects every schedules missing everyMs", async () => {
    const result = await tool.execute(
      {
        action: "add",
        job: {
          name: "Bad Every",
          schedule: { kind: "every" },
          payload: { kind: "systemEvent", text: "hello" },
        },
      },
      mockCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("everyMs must be a positive number");
  });

  it("requires jobId for update action", async () => {
    const result = await tool.execute(
      { action: "update", patch: { name: "x" } },
      mockCtx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("jobId required");
  });

  it("handles remove action", async () => {
    const result = await tool.execute(
      { action: "remove", jobId: "job-1" },
      mockCtx,
    );
    expect(result.success).toBe(true);
    expect(mockCronService.remove).toHaveBeenCalledWith("job-1");
  });

  it("handles run action", async () => {
    const result = await tool.execute(
      { action: "run", jobId: "job-1" },
      mockCtx,
    );
    expect(result.success).toBe(true);
    expect(mockCronService.run).toHaveBeenCalledWith("job-1", "due");
  });

  it("handles run action with force mode", async () => {
    await tool.execute(
      { action: "run", jobId: "job-1", mode: "force" },
      mockCtx,
    );
    expect(mockCronService.run).toHaveBeenCalledWith("job-1", "force");
  });

  it("handles runs action", async () => {
    const result = await tool.execute(
      { action: "runs", jobId: "job-1", limit: 50 },
      mockCtx,
    );
    expect(result.success).toBe(true);
    expect(mockCronService.runs).toHaveBeenCalledWith("job-1", { limit: 50 });
  });

  it("handles wake action", async () => {
    const result = await tool.execute(
      { action: "wake", text: "Wake up!", mode: "now" },
      mockCtx,
    );
    expect(result.success).toBe(true);
    expect(mockCronService.wake).toHaveBeenCalledWith({
      text: "Wake up!",
      mode: "now",
    });
  });

  it("requires text for wake action", async () => {
    const result = await tool.execute({ action: "wake" }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("text required");
  });

  it("handles unknown action", async () => {
    const result = await tool.execute({ action: "unknown" }, mockCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action");
  });
});
