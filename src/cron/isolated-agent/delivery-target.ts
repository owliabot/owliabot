import type { CronPayload } from "../types.js";
import type { IsolatedAgentDeps } from "./types.js";

export type DeliveryMode = "explicit" | "off" | "auto";

export interface ResolvedDeliveryTarget {
  channel?: string;
  to?: string;
  mode: DeliveryMode;
}

export function resolveDeliveryTarget(
  payload: CronPayload,
  deps: Pick<IsolatedAgentDeps, "getLastRoute">,
): ResolvedDeliveryTarget {
  if (payload.kind !== "agentTurn") {
    return { mode: "off" };
  }

  const mode: DeliveryMode =
    payload.deliver === true ? "explicit" : payload.deliver === false ? "off" : "auto";

  if (mode === "off") {
    return { mode: "off" };
  }

  const channelRaw = (payload.channel ?? "").trim();
  const toRaw = (payload.to ?? "").trim();

  if (!channelRaw || channelRaw.toLowerCase() === "last") {
    const last = deps.getLastRoute?.();
    return {
      mode,
      channel: last?.channel,
      to: toRaw || last?.to,
    };
  }

  return {
    mode,
    channel: channelRaw,
    to: toRaw || undefined,
  };
}
