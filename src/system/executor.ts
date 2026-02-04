import { ZodError } from "zod";
import {
  systemRequestSchema,
  execArgsSchema,
  webFetchArgsSchema,
  webSearchArgsSchema,
  type SystemCapabilityConfig,
  type SystemExecutorContext,
  type SystemRequest,
  type SystemResult,
} from "./interface.js";
import { execAction } from "./actions/exec.js";
import { webFetchAction } from "./actions/web-fetch.js";
import { webSearchAction } from "./actions/web-search.js";

const ACTION_LEVEL: Record<string, "read" | "write"> = {
  exec: "write",
  "web.fetch": "read",
  "web.search": "read",
};

function err(code: string, message: string, details?: unknown): SystemResult {
  return { success: false, error: { code, message, details } };
}

export async function executeSystemRequest(
  reqRaw: unknown,
  ctx: SystemExecutorContext,
  config?: SystemCapabilityConfig
): Promise<SystemResult> {
  let req: SystemRequest;
  try {
    req = systemRequestSchema.parse(reqRaw) as SystemRequest;
  } catch (e) {
    const details = e instanceof ZodError ? e.issues : String(e);
    return err("ERR_INVALID_REQUEST", "Invalid system request", details);
  }

  const action = req.payload.action;
  const required = ACTION_LEVEL[action];
  const provided = req.security?.level;

  if (provided && (provided === "sign" || provided !== required)) {
    return err(
      "ERR_PERMISSION_DENIED",
      `security.level mismatch for action ${action} (required ${required})`
    );
  }

  const cfg: SystemCapabilityConfig = config ?? {};

  try {
    if (action === "exec") {
      // Validate args shape early for better errors
      const args = execArgsSchema.parse(req.payload.args);

      const result = await execAction(
        args,
        {
          workspacePath: ctx.workspacePath,
          cwd: req.payload.cwd,
          env: req.payload.env,
        },
        cfg.exec ?? {
          commandAllowList: [],
          envAllowList: [],
          timeoutMs: 60_000,
          maxOutputBytes: 256 * 1024,
        }
      );
      return { success: true, data: result };
    }

    if (action === "web.fetch") {
      const args = webFetchArgsSchema.parse(req.payload.args);
      const result = await webFetchAction(
        args,
        { fetchImpl: ctx.fetchImpl },
        cfg.web ?? {
          domainAllowList: [],
          domainDenyList: [],
          allowPrivateNetworks: false,
          timeoutMs: 15_000,
          maxResponseBytes: 512 * 1024,
          userAgent: "OwliaBot/0.1 (+system-capability)",
          blockOnSecret: true,
        }
      );
      return { success: true, data: result };
    }

    if (action === "web.search") {
      const args = webSearchArgsSchema.parse(req.payload.args);
      const result = await webSearchAction(args, { fetchImpl: ctx.fetchImpl }, cfg);
      return { success: true, data: result };
    }

    return err("ERR_NOT_IMPLEMENTED", `Unknown system action: ${action}`);
  } catch (e) {
    if (e instanceof ZodError) {
      return err("ERR_INVALID_REQUEST", "Invalid args", e.issues);
    }
    return err(
      "ERR_SYSTEM_EXECUTION_FAILED",
      e instanceof Error ? e.message : "System action failed"
    );
  }
}
