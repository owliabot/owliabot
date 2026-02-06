/**
 * CLI Agent Runner
 * Spawns and manages CLI-based LLM processes (claude, codex, etc.)
 * Handles session management, output parsing, and serialization.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../utils/logger.js";
import type { CliBackend } from "./cli-schema.js";
import { resolveCliBackendConfig, resolveCliModel } from "./cli-provider.js";
import type { ConfigWithCliBackends } from "./cli-provider.js";

const log = createLogger("cli-runner");

/** Result from a CLI agent invocation */
export interface CliAgentResult {
  /** Response text from the LLM */
  text: string;
  /** Session ID for continuation (if available) */
  sessionId?: string;
  /** Raw output from the CLI (for debugging) */
  rawOutput?: string;
  /** Additional metadata from the output */
  meta?: Record<string, unknown>;
}

/** Options for running a CLI agent */
export interface CliAgentOptions {
  /** Provider ID (e.g., "claude-cli") */
  provider: string;
  /** Model to use (will be resolved through aliases) */
  model: string;
  /** The user's prompt */
  prompt: string;
  /** System prompt to inject */
  systemPrompt?: string;
  /** Existing session ID to resume */
  sessionId?: string;
  /** Whether this is the first message in the session */
  isFirstMessage?: boolean;
  /** Working directory for the CLI process */
  workdir?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Configuration with optional CLI backend overrides */
  config?: ConfigWithCliBackends;
}

// Serialization queue for backends that require it
const serializationQueues = new Map<string, Promise<void>>();

/**
 * Run a CLI-based LLM agent.
 *
 * @param options - CLI agent options
 * @returns Result containing response text and session info
 */
export async function runCliAgent(options: CliAgentOptions): Promise<CliAgentResult> {
  const {
    provider,
    model,
    prompt,
    systemPrompt,
    sessionId,
    isFirstMessage = !sessionId,
    workdir = process.cwd(),
    timeoutMs = 120_000,
    config,
  } = options;

  // Resolve backend configuration
  const backend = resolveCliBackendConfig(provider, config);

  // Serialize if required
  if (backend.serialize) {
    return serializeExecution(backend.command, () =>
      executeCliAgent(backend, {
        model,
        prompt,
        systemPrompt,
        sessionId,
        isFirstMessage,
        workdir,
        timeoutMs,
      })
    );
  }

  return executeCliAgent(backend, {
    model,
    prompt,
    systemPrompt,
    sessionId,
    isFirstMessage,
    workdir,
    timeoutMs,
  });
}

interface ExecuteOptions {
  model: string;
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  isFirstMessage: boolean;
  workdir: string;
  timeoutMs: number;
}

/**
 * Execute the CLI agent (internal implementation).
 */
async function executeCliAgent(
  backend: CliBackend,
  options: ExecuteOptions
): Promise<CliAgentResult> {
  const { model, prompt, systemPrompt, sessionId, isFirstMessage, workdir, timeoutMs } =
    options;

  // Resolve model through aliases
  const resolvedModel = resolveCliModel(model, backend);

  // Determine if we're resuming or starting fresh
  const isResume = Boolean(sessionId) && backend.sessionMode !== "none";
  const effectiveSessionId = sessionId ?? generateSessionId();

  // Build command arguments
  const { args, useStdinForPrompt } = buildCliArgs(backend, {
    model: resolvedModel,
    prompt,
    systemPrompt,
    sessionId: effectiveSessionId,
    isResume,
    isFirstMessage,
  });

  log.info(`Running CLI: ${backend.command} ${args.join(" ").slice(0, 100)}...`);
  log.debug("Full args:", args);

  // Build environment
  const env = buildEnvironment(backend);

  // Execute the command
  const result = await runCommand(backend.command, args, {
    cwd: workdir,
    env,
    timeoutMs,
    stdin: useStdinForPrompt ? prompt : undefined,
  });

  // Parse output based on format
  return parseOutput(result, backend);
}

/** Result from building CLI args */
interface BuildArgsResult {
  args: string[];
  /** If true, prompt should be sent via stdin instead of args */
  useStdinForPrompt: boolean;
}

/**
 * Build CLI arguments based on backend configuration and options.
 */
function buildCliArgs(
  backend: CliBackend,
  options: {
    model: string;
    prompt: string;
    systemPrompt?: string;
    sessionId: string;
    isResume: boolean;
    isFirstMessage: boolean;
  }
): BuildArgsResult {
  const { model, prompt, systemPrompt, sessionId, isResume, isFirstMessage } = options;
  const args: string[] = [];
  let useStdinForPrompt = backend.input === "stdin";

  // Base args or resume args
  if (isResume && backend.resumeArgs) {
    // Replace {sessionId} placeholder in resume args
    for (const arg of backend.resumeArgs) {
      args.push(arg.replace("{sessionId}", sessionId));
    }
  } else {
    // Use base args
    if (backend.args) {
      args.push(...backend.args);
    }

    // Add session ID for new sessions
    if (backend.sessionMode !== "none" && backend.sessionArg) {
      args.push(backend.sessionArg, sessionId);
    }

    // Add session-specific args for new sessions
    if (backend.sessionArgs) {
      args.push(...backend.sessionArgs);
    }
  }

  // Add model argument
  if (backend.modelArg && model) {
    args.push(backend.modelArg, model);
  }

  // Add system prompt (conditionally)
  if (systemPrompt && backend.systemPromptArg) {
    const shouldInject =
      backend.systemPromptWhen === "always" ||
      (backend.systemPromptWhen === "first" && isFirstMessage);

    if (shouldInject) {
      args.push(backend.systemPromptArg, systemPrompt);
    }
  }

  // Add prompt as argument (if not using stdin)
  if (!useStdinForPrompt) {
    // Check if prompt is too long for arg
    const maxChars = backend.maxPromptArgChars ?? 32_000;
    if (prompt.length <= maxChars) {
      args.push(prompt);
    } else {
      // Fall back to stdin for long prompts
      log.debug(`Prompt too long for arg (${prompt.length} > ${maxChars}), using stdin`);
      useStdinForPrompt = true;
    }
  }

  return { args, useStdinForPrompt };
}

/**
 * Build environment for the CLI process.
 */
function buildEnvironment(backend: CliBackend): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Clear sensitive environment variables
  if (backend.clearEnv) {
    for (const key of backend.clearEnv) {
      delete env[key];
    }
  }

  // Add custom environment variables
  if (backend.env) {
    Object.assign(env, backend.env);
  }

  return env;
}

/**
 * Generate a new session ID.
 */
function generateSessionId(): string {
  return randomUUID();
}

/**
 * Run a command with timeout and capture output.
 */
async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    stdin?: string;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const { cwd, env, timeoutMs, stdin } = options;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      log.warn(`CLI command timed out after ${timeoutMs}ms, killing process`);
      child.kill("SIGTERM");
      // Give it a moment to clean up, then SIGKILL
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    // Write prompt to stdin if configured
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Parse CLI output based on the backend's output format.
 */
function parseOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  backend: CliBackend
): CliAgentResult {
  const { stdout, stderr, exitCode } = result;
  const outputFormat = backend.output ?? "text";

  // Try to parse output first - Claude CLI may return exit code 1 even on success
  // Only treat as error if we can't extract valid content
  if (exitCode !== 0) {
    log.warn(`CLI exited with code ${exitCode}. stderr: ${stderr}`);
    
    // For JSON/JSONL formats, try parsing anyway - output might still be valid
    if ((outputFormat === "json" || outputFormat === "jsonl") && stdout.trim()) {
      const parsed = outputFormat === "json" 
        ? parseJsonOutput(stdout, backend)
        : parseJsonlOutput(stdout, backend);
      
      // If we got meaningful text, use it despite the exit code
      if (parsed.text && !parsed.text.startsWith("Error:")) {
        log.info("CLI exited with non-zero code but produced valid output");
        return parsed;
      }
    }
    
    // No valid output - return error
    log.error(`CLI failed with code ${exitCode}. stderr: ${stderr}`);
    return {
      text: `Error: CLI exited with code ${exitCode}. ${stderr || stdout}`,
      rawOutput: stdout,
    };
  }

  switch (outputFormat) {
    case "json":
      return parseJsonOutput(stdout, backend);

    case "jsonl":
      return parseJsonlOutput(stdout, backend);

    case "text":
    default:
      return {
        text: stdout.trim(),
        rawOutput: stdout,
      };
  }
}

/**
 * Check if a value is a plain object (not array, not null).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Recursively collect text from various nested structures.
 * Handles Claude CLI's various output formats.
 */
function collectText(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry)).join("");
  }
  if (!isRecord(value)) {
    return "";
  }
  // Direct text field
  if (typeof value.text === "string") {
    return value.text;
  }
  // Content can be string or array
  if (typeof value.content === "string") {
    return value.content;
  }
  if (Array.isArray(value.content)) {
    return value.content.map((entry) => collectText(entry)).join("");
  }
  // Nested message object
  if (isRecord(value.message)) {
    return collectText(value.message);
  }
  return "";
}

/**
 * Parse JSON output format.
 * Extracts text content and session ID from the response.
 */
function parseJsonOutput(stdout: string, backend: CliBackend): CliAgentResult {
  try {
    const data = JSON.parse(stdout.trim());

    if (!isRecord(data)) {
      return {
        text: stdout.trim(),
        rawOutput: stdout,
      };
    }

    // Try multiple paths to extract text (matching OpenClaw's logic)
    const text =
      collectText(data.message) ||
      collectText(data.content) ||
      collectText(data.result) ||
      collectText(data);

    // Extract session ID from configured fields
    let sessionId: string | undefined;
    const sessionFields = backend.sessionIdFields ?? ["session_id", "sessionId", "conversation_id"];
    for (const field of sessionFields) {
      const value = getNestedValue(data, field);
      if (typeof value === "string" && value) {
        sessionId = value;
        break;
      }
    }

    return {
      text: text.trim(),
      sessionId,
      rawOutput: stdout,
      meta: data,
    };
  } catch (err) {
    log.warn(`Failed to parse JSON output: ${err}. Returning raw text.`);
    return {
      text: stdout.trim(),
      rawOutput: stdout,
    };
  }
}

/**
 * Parse JSONL (JSON Lines) output format.
 * Aggregates text from multiple lines.
 */
function parseJsonlOutput(stdout: string, backend: CliBackend): CliAgentResult {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const textParts: string[] = [];
  let sessionId: string | undefined;
  let lastMeta: Record<string, unknown> | undefined;

  for (const line of lines) {
    try {
      const data = JSON.parse(line);

      // Collect text from each line
      if (typeof data.text === "string") {
        textParts.push(data.text);
      } else if (typeof data.content === "string") {
        textParts.push(data.content);
      } else if (typeof data.delta?.text === "string") {
        textParts.push(data.delta.text);
      }

      // Check for session ID in each line
      const sessionFields = backend.sessionIdFields ?? ["session_id", "sessionId"];
      for (const field of sessionFields) {
        const value = getNestedValue(data, field);
        if (typeof value === "string" && value) {
          sessionId = value;
          break;
        }
      }

      lastMeta = data;
    } catch (err) {
      // Skip invalid JSON lines
      log.debug(`Skipping invalid JSONL line: ${line.slice(0, 50)}...`);
    }
  }

  return {
    text: textParts.join(""),
    sessionId,
    rawOutput: stdout,
    meta: lastMeta,
  };
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Serialize execution for backends that require it.
 * Ensures only one instance runs at a time per command.
 */
async function serializeExecution<T>(
  command: string,
  fn: () => Promise<T>
): Promise<T> {
  const currentQueue = serializationQueues.get(command) ?? Promise.resolve();

  // Use a deferred pattern: create a promise that resolves when fn() completes
  let resolve: (value: T) => void;
  let reject: (reason: unknown) => void;
  const resultPromise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // Chain onto the queue - fn() is only called once here
  const newQueue = currentQueue.then(async () => {
    try {
      const result = await fn();
      resolve!(result);
    } catch (err) {
      reject!(err);
    }
  });

  serializationQueues.set(command, newQueue);

  // Clean up when done
  newQueue.finally(() => {
    if (serializationQueues.get(command) === newQueue) {
      serializationQueues.delete(command);
    }
  });

  return resultPromise;
}

/**
 * Check if the CLI command is available on the system.
 */
export async function isCliCommandAvailable(command: string): Promise<boolean> {
  try {
    const result = await runCommand("which", [command], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
