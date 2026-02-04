export function createIsolatedSessionKey(jobId: string): string {
  // OpenClaw parity: cron session keys are stable per job.
  // The runner treats each execution as a fresh turn (no history carry-over).
  return `cron:${jobId}`;
}
