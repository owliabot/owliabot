import type { CronJob } from "../types.js";
import type { IsolatedJobRunResult } from "./types.js";

export function shouldSkipDelivery(output: string | undefined): boolean {
  const text = (output ?? "").trim();
  if (!text) {
    return true;
  }

  // Common ack-only forms.
  if (text === "HEARTBEAT_OK") {
    return true;
  }

  // Some variants include surrounding whitespace or very short acknowledgements.
  // If the response starts with HEARTBEAT_OK and has no other substantial content, skip.
  if (text.startsWith("HEARTBEAT_OK")) {
    const rest = text.slice("HEARTBEAT_OK".length).trim();
    if (!rest) {
      return true;
    }
  }

  return false;
}

export function truncateOutput(text: string, maxChars: number): string {
  const limit = Math.max(0, maxChars | 0);
  if (limit === 0) {
    return "";
  }
  if (text.length <= limit) {
    return text;
  }
  // UTF-16 safe truncation (basic). Avoid splitting surrogate pairs.
  const slice = text.slice(0, limit);
  const last = slice.charCodeAt(slice.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    return `${slice.slice(0, -1)}…`;
  }
  return `${slice}…`;
}

export function buildPostToMainMessage(job: CronJob, result: IsolatedJobRunResult): string {
  const prefix = job.isolation?.postToMainPrefix?.trim() || `[cron:${job.id} ${job.name}]`;
  const status = result.status;

  const parts: string[] = [`${prefix} (${status})`];

  if (result.summary && result.summary.trim()) {
    parts.push(result.summary.trim());
  } else if (result.error && result.error.trim()) {
    parts.push(result.error.trim());
  }

  if (result.deliveryResult) {
    const d = result.deliveryResult;
    if (d.sent) {
      parts.push(`Delivered to ${d.channel ?? "?"}:${d.to ?? "?"}.`);
    } else if (d.error) {
      parts.push(`Delivery skipped/failed: ${d.error}`);
    }
  }

  if (job.isolation?.postToMainMode === "full") {
    const maxChars = job.isolation?.postToMainMaxChars ?? 4000;
    const output = truncateOutput((result.output ?? "").trim(), maxChars);
    if (output) {
      parts.push("\n---\n" + output);
    }
  }

  return parts.join("\n").trim();
}
