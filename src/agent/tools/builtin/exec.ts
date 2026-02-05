/**
 * Exec tool - Execute shell commands (allowlist restricted)
 * Wraps system/actions/exec for LLM access
 */
import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import { execAction, type ExecActionContext } from "../../../system/actions/exec.js";
import type { SystemCapabilityConfig } from "../../../system/interface.js";

export interface ExecToolDeps {
  workspacePath: string;
  config: NonNullable<SystemCapabilityConfig["exec"]>;
}

export function createExecTool(deps: ExecToolDeps): ToolDefinition {
  return {
    name: "exec",
    description: `Execute shell commands within the workspace.

SECURITY:
- Only commands in the allowlist can be executed
- Working directory is restricted to workspace
- Environment variables are filtered by allowlist
- Output is truncated if too large
- Execution times out after configured limit

USAGE:
- command: The command to execute (must be in allowlist)
- params: Array of command arguments
- timeoutMs: Optional timeout override`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute (must be in allowlist)",
        },
        params: {
          type: "array",
          description: "Command arguments",
          items: { type: "string" },
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (optional)",
        },
        cwd: {
          type: "string",
          description: "Working directory relative to workspace (optional)",
        },
      },
      required: ["command"],
    },
    security: {
      level: "write",
      confirmRequired: true,
    },
    async execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
      const p = params as ExecToolParams;

      try {
        const actionCtx: ExecActionContext = {
          workspacePath: deps.workspacePath,
          cwd: p.cwd,
        };

        const result = await execAction(
          {
            command: p.command,
            params: p.params,
            timeoutMs: p.timeoutMs,
          },
          actionCtx,
          deps.config
        );

        return {
          success: result.exitCode === 0,
          data: {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            truncated: result.truncated,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
          },
          error: result.exitCode !== 0
            ? `Command exited with code ${result.exitCode}`
            : undefined,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

interface ExecToolParams {
  command: string;
  params?: string[];
  timeoutMs?: number;
  cwd?: string;
}
