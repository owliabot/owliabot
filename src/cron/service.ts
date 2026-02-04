import * as ops from "./service/ops.js";
import { createCronServiceState } from "./service/state.js";
import type {
  CronDeps,
  CronJob,
  CronJobCreateInput,
  CronJobPatch,
  CronRunMode,
} from "./types.js";
import type { CronStatusResult } from "./service/ops.js";

export class CronService {
  private state;

  constructor(deps: CronDeps) {
    this.state = createCronServiceState(deps);
  }

  async start(): Promise<void> {
    await ops.start(this.state);
  }

  stop(): void {
    ops.stop(this.state);
  }

  async status(): Promise<CronStatusResult> {
    return await ops.status(this.state);
  }

  async list(opts?: { includeDisabled?: boolean }): Promise<CronJob[]> {
    return await ops.list(this.state, opts);
  }

  async add(input: CronJobCreateInput): Promise<CronJob> {
    return await ops.add(this.state, input);
  }

  async update(id: string, patch: CronJobPatch): Promise<CronJob> {
    return await ops.update(this.state, id, patch);
  }

  async remove(id: string): Promise<{ ok: boolean; removed: boolean }> {
    return await ops.remove(this.state, id);
  }

  async run(
    id: string,
    mode?: CronRunMode,
  ): Promise<{ ok: boolean; ran: boolean; reason?: string }> {
    return await ops.run(this.state, id, mode);
  }

  wake(opts: { text: string; mode?: "now" | "next-heartbeat" }): { ok: boolean } {
    return ops.wakeNow(this.state, opts);
  }
}
