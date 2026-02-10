/**
 * MCP Auto-Repair Module
 *
 * When an MCP server fails to spawn, this module captures the error output
 * and asks an LLM to diagnose and suggest a fix command. If the LLM suggests
 * a command, it is executed automatically, and the MCP server is retried.
 *
 * This avoids hard-coding specific fix logic (e.g., `npx playwright install chromium`)
 * and instead delegates diagnosis to the LLM.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "../utils/logger.js";
import { runLLM, type LLMProvider } from "../agent/runner.js";
import type { Message } from "../agent/session.js";

const execAsync = promisify(execCb);
const log = createLogger("mcp:auto-repair");

/** Maximum time (ms) to allow a repair command to run */
const REPAIR_COMMAND_TIMEOUT = 120_000;

/** Maximum number of repair attempts per server */
const MAX_REPAIR_ATTEMPTS = 1;

export interface RepairContext {
  /** Name of the MCP server that failed */
  serverName: string;
  /** The command that was attempted */
  command: string;
  /** Arguments passed to the command */
  args?: string[];
  /** Error message / stderr output from the failed spawn */
  errorOutput: string;
  /** Exit code if available */
  exitCode?: number;
}

export interface RepairResult {
  /** Whether a repair was attempted */
  attempted: boolean;
  /** The command that was executed to repair */
  repairCommand?: string;
  /** Whether the repair command succeeded */
  repairSucceeded?: boolean;
  /** Output from the repair command */
  repairOutput?: string;
  /** Error from the repair command if it failed */
  repairError?: string;
}

/**
 * Ask the LLM to diagnose an MCP server spawn failure and suggest a fix command.
 *
 * Returns `null` if the LLM cannot suggest a fix or the response is unparseable.
 */
async function diagnoseMcpFailure(
  ctx: RepairContext,
  provider: LLMProvider,
): Promise<string | null> {
  const fullCommand = [ctx.command, ...(ctx.args ?? [])].join(" ");

  const messages: Message[] = [
    {
      role: "system",
      timestamp: Date.now(),
      content: [
        "You are a system administration assistant. An MCP (Model Context Protocol) server failed to start.",
        "Your job is to analyze the error and suggest ONE shell command to fix the issue.",
        "",
        "Rules:",
        "- Respond with ONLY the shell command to run, nothing else.",
        "- The command should be safe and non-destructive (e.g., installing missing dependencies).",
        "- If you cannot determine a fix, respond with exactly: NO_FIX",
        "- Do not wrap the command in code blocks or quotes.",
        "- The command will be executed in a Linux environment with bash.",
      ].join("\n"),
    },
    {
      role: "user",
      timestamp: Date.now(),
      content: [
        `MCP server "${ctx.serverName}" failed to start.`,
        `Command: ${fullCommand}`,
        ctx.exitCode !== undefined ? `Exit code: ${ctx.exitCode}` : "",
        `Error output:\n${ctx.errorOutput.slice(0, 4000)}`,
        "",
        "What single shell command would fix this? Respond with ONLY the command or NO_FIX.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const response = await runLLM(
      { provider: provider.id, model: provider.model, apiKey: provider.apiKey },
      messages,
      { maxTokens: 256, temperature: 0 },
      provider,
    );

    const suggestion = response.content.trim();

    if (!suggestion || suggestion === "NO_FIX" || suggestion.length > 500) {
      log.info(`LLM could not suggest a fix for "${ctx.serverName}"`);
      return null;
    }

    // Basic sanity: reject obviously dangerous commands
    const dangerous = ["rm -rf /", "mkfs", "dd if=", "> /dev/sd", ":(){ :|:&"];
    if (dangerous.some((d) => suggestion.includes(d))) {
      log.warn(`LLM suggested a potentially dangerous command, rejecting: ${suggestion}`);
      return null;
    }

    return suggestion;
  } catch (err) {
    log.warn(
      `Failed to get LLM diagnosis for "${ctx.serverName}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Execute a repair command suggested by the LLM.
 */
async function executeRepairCommand(command: string): Promise<{ ok: boolean; output: string }> {
  log.info(`Executing repair command: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: REPAIR_COMMAND_TIMEOUT,
      env: { ...process.env },
      shell: "/bin/bash",
    });

    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    log.info(`Repair command completed successfully`);
    return { ok: true, output };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim();
    log.warn(`Repair command failed: ${execErr.message ?? "unknown error"}`);
    return { ok: false, output: output || (execErr.message ?? "unknown error") };
  }
}

/**
 * Attempt to auto-repair an MCP server spawn failure.
 *
 * 1. Sends error context to the LLM for diagnosis
 * 2. If LLM suggests a command, executes it
 * 3. Returns the result so the caller can retry the MCP connection
 *
 * @param ctx - Information about the failed MCP server
 * @param provider - LLM provider to use for diagnosis
 * @returns RepairResult indicating what happened
 */
export async function attemptAutoRepair(
  ctx: RepairContext,
  provider: LLMProvider,
): Promise<RepairResult> {
  log.info(`Attempting auto-repair for MCP server "${ctx.serverName}"`);

  const suggestion = await diagnoseMcpFailure(ctx, provider);
  if (!suggestion) {
    return { attempted: false };
  }

  log.info(`LLM suggested fix for "${ctx.serverName}": ${suggestion}`);

  const { ok, output } = await executeRepairCommand(suggestion);

  return {
    attempted: true,
    repairCommand: suggestion,
    repairSucceeded: ok,
    repairOutput: ok ? output : undefined,
    repairError: ok ? undefined : output,
  };
}

export { MAX_REPAIR_ATTEMPTS };
