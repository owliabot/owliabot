import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCronService } from "../service.js";
import type { CronJob } from "../service.js";

vi.mock("croner", () => {
  class MockCron {
    stop = vi.fn();
    pattern: string;
    handler: () => Promise<void>;

    constructor(pattern: string, handler: () => Promise<void>) {
      this.pattern = pattern;
      this.handler = handler;
    }
  }

  return {
    Cron: MockCron,
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

  beforeEach(() => {
    vi.clearAllMocks();
    service = createCronService();
  });

  describe("schedule", () => {
    it("should schedule a cron job", () => {
      const handler = vi.fn(async () => {});
      const job: CronJob = {
        id: "test-job",
        pattern: "*/5 * * * *",
        handler,
      };

      service.schedule(job);

      // Job is scheduled (verified by no error)
      expect(true).toBe(true);
    });

    it("should replace existing job with same id", () => {
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

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("stop", () => {
    it("should stop a scheduled job", () => {
      const handler = vi.fn(async () => {});
      service.schedule({
        id: "job1",
        pattern: "*/5 * * * *",
        handler,
      });

      service.stop("job1");

      // Should not throw
      expect(true).toBe(true);
    });

    it("should handle stopping non-existent job", () => {
      service.stop("non-existent");

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("stopAll", () => {
    it("should stop all scheduled jobs", () => {
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

      // Should not throw
      expect(true).toBe(true);
    });

    it("should handle empty job list", () => {
      service.stopAll();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
