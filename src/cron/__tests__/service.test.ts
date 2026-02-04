import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCronService } from "../service.js";
import type { CronJob } from "../service.js";

vi.mock("croner", () => {
  const created: any[] = [];

  class MockCron {
    stop = vi.fn();
    pattern: string;
    handler: () => Promise<void>;

    constructor(pattern: string, handler: () => Promise<void>) {
      this.pattern = pattern;
      this.handler = handler;
      created.push(this);
    }
  }

  return {
    Cron: MockCron,
    __getCreated: () => created,
  };
});

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("cron service", () => {
  let service: ReturnType<typeof createCronService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = createCronService();
    const croner = (await import("croner")) as any;
    croner.__getCreated().length = 0;
  });

  describe("schedule", () => {
    it("should schedule a cron job", async () => {
      const handler = vi.fn(async () => {});
      const job: CronJob = {
        id: "test-job",
        pattern: "*/5 * * * *",
        handler,
      };

      service.schedule(job);

      const croner = (await import("croner")) as any;
      const created = croner.__getCreated();
      expect(created).toHaveLength(1);
      expect(created[0].pattern).toBe("*/5 * * * *");
    });

    it("should replace existing job with same id", async () => {
      const handler1 = vi.fn(async () => {});
      const handler2 = vi.fn(async () => {});

      service.schedule({
        id: "job1",
        pattern: "*/5 * * * *",
        handler: handler1,
      });

      service.schedule({
        id: "job1",
        pattern: "*/10 * * * *",
        handler: handler2,
      });

      const croner = (await import("croner")) as any;
      const created = croner.__getCreated();
      expect(created).toHaveLength(2);
      expect(created[0].stop).toHaveBeenCalledTimes(1);
      expect(created[1].pattern).toBe("*/10 * * * *");
    });
  });

  describe("stop", () => {
    it("should stop a scheduled job", async () => {
      const handler = vi.fn(async () => {});
      service.schedule({
        id: "job1",
        pattern: "*/5 * * * *",
        handler,
      });

      service.stop("job1");

      const croner = (await import("croner")) as any;
      const created = croner.__getCreated();
      expect(created[0].stop).toHaveBeenCalledTimes(1);
    });

    it("should handle stopping non-existent job", async () => {
      service.stop("non-existent");

      const croner = (await import("croner")) as any;
      const created = croner.__getCreated();
      expect(created.length).toBe(0);
    });
  });

  describe("stopAll", () => {
    it("should stop all scheduled jobs", async () => {
      const handler1 = vi.fn(async () => {});
      const handler2 = vi.fn(async () => {});

      service.schedule({
        id: "job1",
        pattern: "*/5 * * * *",
        handler: handler1,
      });

      service.schedule({
        id: "job2",
        pattern: "*/10 * * * *",
        handler: handler2,
      });

      service.stopAll();

      const croner = (await import("croner")) as any;
      const created = croner.__getCreated();
      expect(created[0].stop).toHaveBeenCalledTimes(1);
      expect(created[1].stop).toHaveBeenCalledTimes(1);
    });

    it("should handle empty job list", async () => {
      service.stopAll();

      const croner = (await import("croner")) as any;
      const created = croner.__getCreated();
      expect(created.length).toBe(0);
    });
  });
});
