#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const goOnboardDir = path.join(rootDir, "client");

function terminate(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    child.kill();
    return;
  }

  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      return false;
    }
  };

  if (!killGroup("SIGINT")) {
    child.kill("SIGINT");
  }

  setTimeout(() => {
    if (!killGroup("SIGKILL") && !child.killed) {
      child.kill("SIGKILL");
    }
  }, 1200).unref();
}

async function main() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "owliabot-onboard-config-"));
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "owliabot-onboard-output-"));

  let transcript = "";
  let plainTranscript = "";
  let reachedStepTwo = false;
  let usedDockerExitFallback = false;
  let lastConfirmAt = 0;
  let timedOut = false;
  let exitCode = 1;

  try {
    const child = spawn(
      "go",
      ["run", ".", "--config-dir", configDir, "--output-dir", outputDir],
      {
        cwd: goOnboardDir,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          GOCACHE: process.env.GOCACHE ?? path.join(os.tmpdir(), "go-build"),
          GOMODCACHE: process.env.GOMODCACHE ?? path.join(os.tmpdir(), "go-mod"),
          CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
          GOPROXY: process.env.GOPROXY ?? "off",
          GOSUMDB: process.env.GOSUMDB ?? "off",
        },
      },
    );

    child.stdin.on("error", () => {});

    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      transcript += text;
      plainTranscript += normalizeTerminalText(text);

      if (!reachedStepTwo && /\bStep\s*1(?:\s*\/\s*\d+|\s+of\s+\d+)\b/i.test(plainTranscript)) {
        const now = Date.now();
        if (now-lastConfirmAt >= 700) {
          // Step 1 can appear multiple times (for example Docker preflight retries on CI runners).
          // Prefer progressing toward Step 2, but fall back to graceful exit when Docker is unavailable.
          const response = shouldExitWhenDockerUnavailable(plainTranscript) ? "3" : "1";
          if (response === "3") {
            usedDockerExitFallback = true;
          }
          child.stdin.write(`${response}\r\n`);
          lastConfirmAt = now;
        }
      }

      if (!reachedStepTwo && /\bStep\s*2(?:\s*\/\s*\d+|\s+of\s+\d+)\b/i.test(plainTranscript)) {
        reachedStepTwo = true;
        terminate(child);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, 20000);

    exitCode = await new Promise((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });
    clearTimeout(timeout);
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }

  if (reachedStepTwo) {
    console.log("onboard-go smoke passed (reached Step 2)");
    return 0;
  }

  if (usedDockerExitFallback && exitCode === 0) {
    console.log("onboard-go smoke passed (docker unavailable graceful-exit path)");
    return 0;
  }

  const tail = plainTranscript.slice(-4000);
  console.error("onboard-go smoke failed: did not reach Step 2");
  if (timedOut) {
    console.error("reason: timeout");
  }
  console.error(`exit code: ${exitCode}`);
  console.error(tail);
  return 1;
}

process.exit(await main());

function normalizeTerminalText(value) {
  // OSC control sequences: ESC ] ... BEL or ESC ] ... ESC \
  let output = value.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
  // CSI control sequences: ESC [ ... final byte
  output = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  // Single-character ESC control sequences.
  output = output.replace(/\u001b[@-_]/g, "");
  // Normalize carriage-return updates into plain stream text.
  output = output.replace(/\r/g, "");
  return output;
}

function shouldExitWhenDockerUnavailable(text) {
  const hasExitOption = /\bExit onboarding\b/i.test(text);
  const needsDockerPrompt = /Docker is required for initialization/i.test(text) ||
    /Docker is installed, but the Docker engine is not running/i.test(text);
  const dockerUnavailable = /Docker CLI:\s*not installed/i.test(text) ||
    /Docker check:\s*Docker CLI not found/i.test(text) ||
    /Docker engine is not running/i.test(text) ||
    /Docker check:\s*.*(daemon|not running|not reachable)/i.test(text);
  return hasExitOption && (needsDockerPrompt || dockerUnavailable);
}
