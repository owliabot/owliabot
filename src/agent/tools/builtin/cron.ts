/**
 * Cron tool for managing scheduled jobs
 * API matches OpenClaw cron tool for compatibility
 */
import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import type { CronService } from "../../../cron/service.js";
import type {
  CronJobCreateInput,
  CronJobPatch,
  CronSchedule,
  CronPayload,
  CronSessionTarget,
  CronWakeMode,
} from "../../../cron/types.js";

export interface CronToolDeps {
  cronService: CronService;
}

export function createCronTool(deps: CronToolDeps): ToolDefinition {
  return {
    name: "cron",
    description: `Manage cron jobs and wake events.

ACTIONS:
- status: Check cron scheduler status
- list: List jobs (use includeDisabled:true to include disabled)
- add: Create job (requires job object)
- update: Modify job (requires jobId + patch object)
- remove: Delete job (requires jobId)
- run: Trigger job immediately (requires jobId)
- runs: Get job run history (requires jobId)
- wake: Send wake event (requires text, optional mode)

JOB SCHEMA (for add action):
{
  "name": "string",
  "schedule": { ... },      // Required: when to run
  "payload": { ... },       // Required: what to execute
  "sessionTarget": "main" | "isolated",
  "enabled": true | false   // Optional, default true
}

SCHEDULE TYPES:
- "at": One-shot at absolute time { "kind": "at", "atMs": <unix-ms> }
- "every": Recurring interval { "kind": "every", "everyMs": <ms> }
- "cron": Cron expression { "kind": "cron", "expr": "<cron>", "tz": "<tz>" }

PAYLOAD TYPES:
- "systemEvent": For main session { "kind": "systemEvent", "text": "<msg>" }
- "agentTurn": For isolated session { "kind": "agentTurn", "message": "<prompt>", "model": "...", "deliver": true, "channel": "...", "to": "..." }`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action to perform",
          enum: ["status", "list", "add", "update", "remove", "run", "runs", "wake"],
        },
        jobId: {
          type: "string",
          description: "Job ID for update/remove/run/runs actions",
        },
        job: {
          type: "object",
          description: "Job configuration for add action",
        },
        patch: {
          type: "object",
          description: "Patch object for update action",
        },
        includeDisabled: {
          type: "boolean",
          description: "Include disabled jobs in list",
        },
        mode: {
          type: "string",
          description: "Run mode (due|force) or wake mode (now|next-heartbeat)",
          enum: ["due", "force", "now", "next-heartbeat"],
        },
        text: {
          type: "string",
          description: "Text for wake action",
        },
        limit: {
          type: "number",
          description: "Limit for runs action",
        },
      },
      required: ["action"],
    },
    security: {
      level: "write",
    },
    async execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
      const p = params as CronToolParams;

      try {
        switch (p.action) {
          case "status":
            return { success: true, data: await deps.cronService.status() };

          case "list":
            return {
              success: true,
              data: await deps.cronService.list({ includeDisabled: p.includeDisabled }),
            };

          case "add": {
            if (!p.job) {
              return { success: false, error: "job object required for add action" };
            }
            const input = normalizeJobInput(p.job);
            const job = await deps.cronService.add(input);
            return { success: true, data: job };
          }

          case "update": {
            if (!p.jobId) {
              return { success: false, error: "jobId required for update action" };
            }
            if (!p.patch) {
              return { success: false, error: "patch object required for update action" };
            }
            const patch = normalizePatch(p.patch);
            const job = await deps.cronService.update(p.jobId, patch);
            return { success: true, data: job };
          }

          case "remove": {
            if (!p.jobId) {
              return { success: false, error: "jobId required for remove action" };
            }
            const result = await deps.cronService.remove(p.jobId);
            return { success: true, data: result };
          }

          case "run": {
            if (!p.jobId) {
              return { success: false, error: "jobId required for run action" };
            }
            const runMode = p.mode === "force" ? "force" : "due";
            const result = await deps.cronService.run(p.jobId, runMode);
            return { success: true, data: result };
          }

          case "runs": {
            if (!p.jobId) {
              return { success: false, error: "jobId required for runs action" };
            }
            const entries = await deps.cronService.runs(p.jobId, { limit: p.limit });
            return { success: true, data: entries };
          }

          case "wake": {
            if (!p.text) {
              return { success: false, error: "text required for wake action" };
            }
            const wakeMode = p.mode === "now" ? "now" : "next-heartbeat";
            const result = deps.cronService.wake({ text: p.text, mode: wakeMode });
            return { success: true, data: result };
          }

          default:
            return { success: false, error: `Unknown action: ${p.action}` };
        }
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  };
}

interface CronToolParams {
  action: string;
  jobId?: string;
  job?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  includeDisabled?: boolean;
  mode?: string;
  text?: string;
  limit?: number;
}

function normalizeJobInput(raw: Record<string, unknown>): CronJobCreateInput {
  const schedule = normalizeSchedule(raw.schedule as Record<string, unknown>);
  const payload = normalizePayload(raw.payload as Record<string, unknown>);
  const sessionTarget = (raw.sessionTarget as CronSessionTarget) ?? 
    (payload.kind === "systemEvent" ? "main" : "isolated");
  const wakeMode = (raw.wakeMode as CronWakeMode) ?? "next-heartbeat";

  return {
    name: String(raw.name ?? ""),
    description: raw.description ? String(raw.description) : undefined,
    enabled: raw.enabled !== false,
    deleteAfterRun: raw.deleteAfterRun === true,
    schedule,
    sessionTarget,
    wakeMode,
    payload,
    isolation: raw.isolation as CronJobCreateInput["isolation"],
    agentId: raw.agentId ? String(raw.agentId) : undefined,
  };
}

function normalizeSchedule(raw: Record<string, unknown> | undefined): CronSchedule {
  if (!raw) {
    throw new Error("schedule is required");
  }

  const kind = raw.kind as string;

  if (kind === "at" || raw.atMs !== undefined || raw.at !== undefined) {
    const atMs = parseAtMs(raw.atMs ?? raw.at);
    return { kind: "at", atMs };
  }

  if (kind === "every" || raw.everyMs !== undefined) {
    const everyMs = Number(raw.everyMs);
    if (!Number.isFinite(everyMs) || everyMs <= 0) {
      throw new Error("Invalid every schedule: everyMs must be a positive number");
    }
    const anchorMs = raw.anchorMs !== undefined ? Number(raw.anchorMs) : undefined;
    if (anchorMs !== undefined && !Number.isFinite(anchorMs)) {
      throw new Error("Invalid every schedule: anchorMs must be a number");
    }
    return {
      kind: "every",
      everyMs,
      anchorMs,
    };
  }

  if (kind === "cron" || raw.expr !== undefined) {
    return {
      kind: "cron",
      expr: String(raw.expr),
      tz: raw.tz ? String(raw.tz) : undefined,
    };
  }

  throw new Error("Invalid schedule: must have kind or atMs/everyMs/expr");
}

function parseAtMs(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    // Try parsing as epoch ms
    if (/^\d+$/.test(value)) {
      return Number(value);
    }
    // Try parsing as ISO date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  throw new Error("Invalid atMs: must be epoch ms or ISO date string");
}

function normalizePayload(raw: Record<string, unknown> | undefined): CronPayload {
  if (!raw) {
    throw new Error("payload is required");
  }

  const kind = raw.kind as string;

  if (kind === "systemEvent") {
    return {
      kind: "systemEvent",
      text: String(raw.text ?? ""),
    };
  }

  if (kind === "agentTurn") {
    return {
      kind: "agentTurn",
      message: String(raw.message ?? ""),
      model: raw.model ? String(raw.model) : undefined,
      thinking: raw.thinking ? String(raw.thinking) : undefined,
      timeoutSeconds: raw.timeoutSeconds !== undefined ? Number(raw.timeoutSeconds) : undefined,
      deliver: raw.deliver !== undefined ? Boolean(raw.deliver) : undefined,
      channel: raw.channel ? String(raw.channel) : undefined,
      to: raw.to ? String(raw.to) : undefined,
      bestEffortDeliver: raw.bestEffortDeliver === true,
    };
  }

  throw new Error("Invalid payload: kind must be systemEvent or agentTurn");
}

function normalizePayloadPatch(
  raw: Record<string, unknown> | undefined,
): CronJobPatch["payload"] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const kind = raw.kind as string | undefined;
  if (!kind) {
    throw new Error("Invalid payload patch: kind is required");
  }

  if (kind === "systemEvent") {
    const patch: any = { kind: "systemEvent" };
    if (raw.text !== undefined) {
      const text = String(raw.text);
      if (!text.trim()) {
        throw new Error('Invalid payload patch: systemEvent requires non-empty text');
      }
      patch.text = text;
    }
    return patch;
  }

  if (kind === "agentTurn") {
    const patch: any = { kind: "agentTurn" };
    if (raw.message !== undefined) {
      const message = String(raw.message);
      if (!message.trim()) {
        throw new Error('Invalid payload patch: agentTurn requires non-empty message');
      }
      patch.message = message;
    }
    if (raw.model !== undefined) patch.model = String(raw.model);
    if (raw.thinking !== undefined) patch.thinking = String(raw.thinking);
    if (raw.timeoutSeconds !== undefined) patch.timeoutSeconds = Number(raw.timeoutSeconds);
    if (raw.deliver !== undefined) patch.deliver = Boolean(raw.deliver);
    if (raw.channel !== undefined) patch.channel = String(raw.channel);
    if (raw.to !== undefined) patch.to = String(raw.to);
    if (raw.bestEffortDeliver !== undefined) patch.bestEffortDeliver = Boolean(raw.bestEffortDeliver);
    return patch;
  }

  throw new Error("Invalid payload patch: kind must be systemEvent or agentTurn");
}

function normalizePatch(raw: Record<string, unknown>): CronJobPatch {
  const patch: CronJobPatch = {};

  if (raw.name !== undefined) patch.name = String(raw.name);
  if (raw.description !== undefined) patch.description = raw.description ? String(raw.description) : undefined;
  if (raw.enabled !== undefined) patch.enabled = Boolean(raw.enabled);
  if (raw.deleteAfterRun !== undefined) patch.deleteAfterRun = Boolean(raw.deleteAfterRun);
  if (raw.wakeMode !== undefined) patch.wakeMode = raw.wakeMode as CronWakeMode;
  if (raw.sessionTarget !== undefined) patch.sessionTarget = raw.sessionTarget as CronSessionTarget;
  if (raw.agentId !== undefined) patch.agentId = raw.agentId ? String(raw.agentId) : null;

  if (raw.schedule !== undefined) {
    patch.schedule = normalizeSchedule(raw.schedule as Record<string, unknown>);
  }

  if (raw.payload !== undefined) {
    const payloadPatch = normalizePayloadPatch(raw.payload as Record<string, unknown> | undefined);
    if (payloadPatch !== undefined) {
      patch.payload = payloadPatch;
    }
  }

  if (raw.isolation !== undefined) {
    patch.isolation = raw.isolation as CronJobPatch["isolation"];
  }

  return patch;
}
