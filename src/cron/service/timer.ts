import { appendCronRunLog, resolveCronRunLogPath } from "../run-log.js";
import type { CronJob, CronRunStatus } from "../types.js";
import { computeJobNextRunAtMs, nextWakeAtMs, resolveJobPayloadTextForMain } from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist } from "./store.js";
import type { CronServiceState } from "./state.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function armTimer(state: CronServiceState): void {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;

  if (!state.deps.cronEnabled) {
    return;
  }

  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    return;
  }

  const delay = Math.max(nextAt - state.deps.nowMs(), 0);
  // Avoid TimeoutOverflowWarning when a job is far in the future.
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS);

  state.timer = setTimeout(() => {
    void onTimer(state).catch((err) => {
      state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
    });
  }, clampedDelay);

  state.timer.unref?.();
}

export function stopTimer(state: CronServiceState): void {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
}

export async function onTimer(state: CronServiceState): Promise<void> {
  if (state.running) {
    return;
  }

  state.running = true;
  try {
    await locked(state, async () => {
      await ensureLoaded(state);
      await runDueJobs(state);
      await persist(state);
      armTimer(state);
    });
  } finally {
    state.running = false;
  }
}

async function runDueJobs(state: CronServiceState): Promise<void> {
  if (!state.store) {
    return;
  }

  const now = state.deps.nowMs();
  const due = state.store.jobs.filter((j) => {
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    const next = j.state.nextRunAtMs;
    return typeof next === "number" && now >= next;
  });

  for (const job of due) {
    await executeJob(state, job, now, { forced: false });
  }
}

export async function executeJob(
  state: CronServiceState,
  job: CronJob,
  nowMs: number,
  opts: { forced: boolean },
): Promise<void> {
  const startedAt = state.deps.nowMs();
  job.state.runningAtMs = startedAt;
  job.state.lastError = undefined;

  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });

  let deleted = false;

  const finish = async (
    status: CronRunStatus,
    err?: string,
    summary?: string,
  ): Promise<void> => {
    const endedAt = state.deps.nowMs();

    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startedAt;
    job.state.lastStatus = status;
    job.state.lastDurationMs = Math.max(0, endedAt - startedAt);
    job.state.lastError = err;

    const shouldDelete =
      job.schedule.kind === "at" &&
      status === "ok" &&
      job.deleteAfterRun === true;

    if (!shouldDelete) {
      if (job.schedule.kind === "at" && status === "ok") {
        // One-shot job completed successfully; disable it.
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, endedAt);
      } else {
        job.state.nextRunAtMs = undefined;
      }
    }

    emit(state, {
      jobId: job.id,
      action: "finished",
      status,
      error: err,
      summary,
      runAtMs: startedAt,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
    });

    try {
      const filePath = resolveCronRunLogPath({
        storePath: state.deps.storePath,
        jobId: job.id,
      });
      await appendCronRunLog(filePath, {
        ts: endedAt,
        jobId: job.id,
        action: "finished",
        status,
        error: err,
        summary,
        runAtMs: startedAt,
        durationMs: job.state.lastDurationMs,
        nextRunAtMs: job.state.nextRunAtMs,
      });
    } catch (err2) {
      state.deps.log.warn(
        { jobId: job.id, err: String(err2) },
        "cron: failed to append run log",
      );
    }

    if (shouldDelete && state.store) {
      state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
      deleted = true;
      emit(state, { jobId: job.id, action: "removed" });
    }
  };

  try {
    if (job.sessionTarget === "main") {
      const text = resolveJobPayloadTextForMain(job);
      if (!text) {
        const kind = job.payload.kind;
        await finish(
          "skipped",
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
        );
        return;
      }

      state.deps.enqueueSystemEvent(text, { agentId: job.agentId });

      if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
        const reason = `cron:${job.id}`;
        const delay = (ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms));
        const maxWaitMs = 2 * 60_000;
        const waitStartedAt = state.deps.nowMs();

        let heartbeatResult: any;
        for (;;) {
          heartbeatResult = await state.deps.runHeartbeatOnce({ reason });
          if (
            heartbeatResult.status !== "skipped" ||
            heartbeatResult.reason !== "requests-in-flight"
          ) {
            break;
          }
          if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
            heartbeatResult = {
              status: "skipped",
              reason: "timeout waiting for main lane to become idle",
            };
            break;
          }
          await delay(250);
        }

        if (heartbeatResult.status === "ran") {
          await finish("ok", undefined, text);
        } else if (heartbeatResult.status === "skipped") {
          await finish("skipped", heartbeatResult.reason, text);
        } else {
          await finish("error", heartbeatResult.reason, text);
        }
      } else {
        // wakeMode is "next-heartbeat" or runHeartbeatOnce not available
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
        await finish("ok", undefined, text);
      }
      return;
    }

    // isolated sessionTarget
    if (!state.deps.runIsolatedAgentJob) {
      await finish("skipped", "isolated agent deps not configured");
      return;
    }

    const isolatedResult = await state.deps.runIsolatedAgentJob({
      job,
      message: job.payload.kind === "agentTurn" ? job.payload.message : "",
    });

    // The isolated runner already posts summary to main; we just record the result.
    if (isolatedResult.status === "ok") {
      await finish("ok", undefined, isolatedResult.summary);
    } else if (isolatedResult.status === "skipped") {
      await finish("skipped", isolatedResult.error ?? isolatedResult.summary, isolatedResult.summary);
    } else {
      await finish("error", isolatedResult.error ?? "unknown error", isolatedResult.summary);
    }

    // If wakeMode is "now", request heartbeat after posting summary
    if (job.wakeMode === "now") {
      state.deps.requestHeartbeatNow({ reason: `cron:${job.id}:post` });
    }
  } catch (err) {
    await finish("error", String(err));
  } finally {
    job.updatedAtMs = nowMs;
    if (!opts.forced && job.enabled && !deleted) {
      // Keep nextRunAtMs in sync in case the schedule advanced during a long run.
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, state.deps.nowMs());
    }
  }
}

export function wake(
  state: CronServiceState,
  opts: { text: string; mode?: "now" | "next-heartbeat" },
): { ok: boolean } {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false };
  }

  state.deps.enqueueSystemEvent(text);
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" });
  }

  return { ok: true };
}

export function emit(state: CronServiceState, evt: any): void {
  try {
    state.deps.onEvent?.(evt);
  } catch {
    /* ignore */
  }
}
