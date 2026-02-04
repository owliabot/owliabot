import type { CronJob } from "../types.js";
import { resolveDeliveryTarget } from "./delivery-target.js";
import { shouldSkipDelivery, buildPostToMainMessage } from "./helpers.js";
import { createIsolatedSessionKey } from "./session.js";
import type { IsolatedAgentDeps, IsolatedJobRunResult } from "./types.js";

export async function runIsolatedAgentJob(
  job: CronJob,
  deps: IsolatedAgentDeps,
): Promise<IsolatedJobRunResult> {
  if (job.payload.kind !== "agentTurn") {
    const result: IsolatedJobRunResult = {
      status: "skipped",
      summary: 'isolated jobs require payload.kind="agentTurn"',
    };
    deps.enqueueSystemEvent(buildPostToMainMessage(job, result), { agentId: job.agentId });
    return result;
  }

  const sessionKey = createIsolatedSessionKey(job.id);
  const prefix = `[cron:${job.id} ${job.name}]`;
  const message = `${prefix} ${job.payload.message ?? ""}`.trim();

  let output = "";
  let runError: string | undefined;

  try {
    const resp = await deps.runAgentTurn(sessionKey, message, {
      model: job.payload.model,
      thinking: job.payload.thinking,
      timeoutSeconds: job.payload.timeoutSeconds,
    });
    output = resp?.output ?? "";
    runError = resp?.error;
  } catch (err) {
    runError = String(err);
  }

  let result: IsolatedJobRunResult;

  if (runError) {
    result = { status: "error", error: runError, output };
  } else {
    result = { status: "ok", output };
  }

  const delivery = resolveDeliveryTarget(job.payload, deps);
  const wantsDelivery =
    delivery.mode === "explicit" || (delivery.mode === "auto" && Boolean(delivery.to));

  if (wantsDelivery && !shouldSkipDelivery(output)) {
    if (!delivery.channel || !delivery.to) {
      result.deliveryResult = {
        sent: false,
        channel: delivery.channel,
        to: delivery.to,
        error: "delivery target not resolved",
      };
      if (delivery.mode === "explicit" && result.status === "ok") {
        result.status = "error";
        result.error = result.deliveryResult.error;
      }
    } else {
      try {
        await deps.sendMessage(delivery.channel, delivery.to, output);
        result.deliveryResult = { sent: true, channel: delivery.channel, to: delivery.to };
      } catch (err) {
        result.deliveryResult = {
          sent: false,
          channel: delivery.channel,
          to: delivery.to,
          error: String(err),
        };
        if (delivery.mode === "explicit" && result.status === "ok") {
          result.status = "error";
          result.error = String(err);
        }
      }
    }
  } else if (wantsDelivery) {
    result.deliveryResult = {
      sent: false,
      channel: delivery.channel,
      to: delivery.to,
      error: "skipped: no deliverable content",
    };
  }

  // Summary: prefer explicit error/delivery outcome; otherwise include a short excerpt.
  if (!result.summary) {
    if (result.status === "error") {
      result.summary = result.error ?? "error";
    } else if (output.trim()) {
      const clean = output.trim();
      result.summary = clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
    } else {
      result.summary = "(no output)";
    }
  }

  deps.enqueueSystemEvent(buildPostToMainMessage(job, result), { agentId: job.agentId });
  return result;
}
