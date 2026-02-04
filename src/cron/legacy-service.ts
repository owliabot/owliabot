/**
 * Cron service for scheduled tasks
 * @see design.md Section 4.1
 */

import { Cron } from "croner";
import { createLogger } from "../utils/logger.js";

const log = createLogger("cron");

export interface CronJob {
  id: string;
  pattern: string;
  handler: () => Promise<void>;
}

export interface CronService {
  schedule(job: CronJob): void;
  stop(id: string): void;
  stopAll(): void;
}

export function createCronService(): CronService {
  const jobs = new Map<string, Cron>();

  return {
    schedule(job: CronJob): void {
      if (jobs.has(job.id)) {
        log.warn(`Job ${job.id} already exists, replacing...`);
        jobs.get(job.id)?.stop();
      }

      const cronJob = new Cron(job.pattern, async () => {
        log.info(`Running cron job: ${job.id}`);
        try {
          await job.handler();
          log.info(`Cron job ${job.id} completed`);
        } catch (err) {
          log.error(`Cron job ${job.id} failed`, err);
        }
      });

      jobs.set(job.id, cronJob);
      log.info(`Scheduled cron job: ${job.id} (${job.pattern})`);
    },

    stop(id: string): void {
      const job = jobs.get(id);
      if (job) {
        job.stop();
        jobs.delete(id);
        log.info(`Stopped cron job: ${id}`);
      }
    },

    stopAll(): void {
      for (const [id, job] of jobs) {
        job.stop();
        log.info(`Stopped cron job: ${id}`);
      }
      jobs.clear();
    },
  };
}
