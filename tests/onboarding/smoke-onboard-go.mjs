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
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    child.kill();
    return;
  }
  child.kill("SIGINT");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 1200).unref();
}

async function main() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "owliabot-onboard-config-"));
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "owliabot-onboard-output-"));

  let transcript = "";
  let plainTranscript = "";
  let reachedStepTwo = false;
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
      plainTranscript += stripAnsi(text).replace(/\r/g, "");

      if (!reachedStepTwo && /(Step 1\/\d+|Step 1 of \d+)/.test(plainTranscript)) {
        const now = Date.now();
        if (now-lastConfirmAt >= 700) {
          // Step 1 can appear multiple times (for example Docker preflight retries on CI runners).
          // Always pick the first option to keep smoke flow moving toward Step 2.
          child.stdin.write("1\n");
          lastConfirmAt = now;
        }
      }

      if (!reachedStepTwo && /(Step 2\/\d+|Step 2 of \d+)/.test(plainTranscript)) {
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

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
