import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { execArgsSchema, type ExecArgs, type SystemCapabilityConfig } from "../interface.js";
import { checkCommandWhitelist } from "../security/command-whitelist.js";
import { sanitizeEnv } from "../security/env-sanitizer.js";

export interface ExecActionContext {
  workspacePath: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecActionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

async function resolveCwd(workspacePath: string, cwd?: string): Promise<string> {
  const wsReal = await realpath(workspacePath);
  const target = cwd
    ? isAbsolute(cwd)
      ? cwd
      : resolve(workspacePath, cwd)
    : workspacePath;

  const targetReal = await realpath(target);

  // Ensure target is within workspace real path
  const rel = targetReal.startsWith(wsReal) ? targetReal.slice(wsReal.length) : null;
  if (rel === null || (rel.length > 0 && !rel.startsWith("/"))) {
    throw new Error("CWD must be within workspace");
  }

  return targetReal;
}

export async function execAction(
  argsRaw: unknown,
  ctx: ExecActionContext,
  config: SystemCapabilityConfig["exec"]
): Promise<ExecActionResult> {
  const parsed = execArgsSchema.parse(argsRaw) as ExecArgs & { params: string[] };

  const allowList = config?.commandAllowList ?? [];
  const verdict = checkCommandWhitelist(parsed.command, allowList);
  if (!verdict.allowed) {
    throw new Error(`Command not allowed: ${verdict.reason ?? "denied"}`);
  }

  const cwd = await resolveCwd(ctx.workspacePath, ctx.cwd);

  const timeoutMs = parsed.timeoutMs ?? config?.timeoutMs ?? 60_000;
  const maxOutputBytes = config?.maxOutputBytes ?? 256 * 1024;
  const envAllowList = config?.envAllowList ?? [];

  const { env } = sanitizeEnv(ctx.env, envAllowList);

  const started = Date.now();

  return await new Promise<ExecActionResult>((resolvePromise) => {
    const child = spawn(parsed.command, parsed.params ?? [], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    let timedOut = false;

    const killForLimit = () => {
      if (child.killed) return;
      truncated = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    };

    const onData = (which: "stdout" | "stderr", chunk: Buffer) => {
      total += chunk.length;
      if (total > maxOutputBytes) {
        killForLimit();
        return;
      }
      if (which === "stdout") stdoutChunks.push(chunk);
      else stderrChunks.push(chunk);
    };

    child.stdout?.on("data", (d) => onData("stdout", Buffer.from(d)));
    child.stderr?.on("data", (d) => onData("stderr", Buffer.from(d)));

    const t = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(t);
      const durationMs = Date.now() - started;
      resolvePromise({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        truncated,
        timedOut,
        durationMs,
      });
    };

    child.on("error", (err) => {
      clearTimeout(t);
      const durationMs = Date.now() - started;
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: String(err?.message ?? err),
        truncated,
        timedOut,
        durationMs,
      });
    });

    child.on("close", (code, signal) => finish(code, signal));
  });
}
