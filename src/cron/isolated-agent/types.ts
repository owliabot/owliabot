import type { CronSystemEventOptions } from "../types.js";

export interface IsolatedJobRunResult {
  status: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
  output?: string;
  deliveryResult?: {
    sent: boolean;
    channel?: string;
    to?: string;
    error?: string;
  };
}

export interface IsolatedAgentDeps {
  runAgentTurn: (
    sessionKey: string,
    message: string,
    opts?: { model?: string; thinking?: string; timeoutSeconds?: number },
  ) => Promise<{ output: string; error?: string }>;

  sendMessage: (channel: string, to: string, message: string) => Promise<void>;

  getLastRoute: () => { channel?: string; to?: string } | undefined;

  enqueueSystemEvent: (text: string, opts?: CronSystemEventOptions) => void;
}
