// Cron types (OpenClaw-parity)

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "now" | "next-heartbeat";

export type CronSchedule =
  | { kind: "at"; atMs: number }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      deliver?: boolean;
      channel?: string;
      to?: string;
      bestEffortDeliver?: boolean;

      /** @deprecated legacy */
      provider?: string;
    };

export type CronRunStatus = "ok" | "error" | "skipped";

export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: CronRunStatus;
  lastDurationMs?: number;
  lastError?: string;
}

export interface CronJobIsolation {
  postToMainPrefix?: string;
  postToMainMode?: "summary" | "full";
  postToMainMaxChars?: number;
}

export interface CronJob {
  id: string;
  agentId?: string | null;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;

  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;

  payload: CronPayload;
  isolation?: CronJobIsolation;

  state: CronJobState;
}

export interface CronStore {
  version: 1;
  jobs: CronJob[];
}

export type CronJobCreateInput = Omit<
  CronJob,
  "id" | "createdAtMs" | "updatedAtMs" | "state"
> & {
  state?: Partial<CronJobState>;
};

export type CronJobPatch = Partial<
  Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs">
> & {
  state?: Partial<CronJobState>;
  payload?: Partial<CronPayload> & { kind: CronPayload["kind"] };
};

export type CronRunMode = "due" | "force";

export type CronEvent =
  | { jobId: string; action: "added"; nextRunAtMs?: number }
  | { jobId: string; action: "updated"; nextRunAtMs?: number }
  | { jobId: string; action: "removed" }
  | { jobId: string; action: "started"; runAtMs: number }
  | {
      jobId: string;
      action: "finished";
      status: CronRunStatus;
      error?: string;
      summary?: string;
      runAtMs: number;
      durationMs: number;
      nextRunAtMs?: number;
    };

export interface CronRunHeartbeatResult {
  status: "ran" | "skipped" | "error";
  reason: string;
}

export interface CronSystemEventOptions {
  agentId?: string | null;
}

export interface CronHeartbeatRequestOptions {
  reason: string;
}

export interface CronIsolatedAgentJobResult {
  status: CronRunStatus;
  summary: string;
  error?: string;
  outputText?: string;
}

export interface CronDeps {
  cronEnabled: boolean;
  storePath: string;
  log: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };

  nowMs?: () => number;
  onEvent?: (evt: CronEvent) => void;

  enqueueSystemEvent(text: string, opts?: CronSystemEventOptions): void;
  requestHeartbeatNow(opts: CronHeartbeatRequestOptions): void;

  runHeartbeatOnce?: (opts: CronHeartbeatRequestOptions) => Promise<CronRunHeartbeatResult>;
  runIsolatedAgentJob: (opts: {
    job: CronJob;
    message: string;
  }) => Promise<CronIsolatedAgentJobResult>;
}
