#!/usr/bin/env bun

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const goOnboardDir = path.join(rootDir, "go-onboard");
const args = process.argv.slice(2);

const env = {
  ...process.env,
  GOCACHE: process.env.GOCACHE ?? path.join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", "go-build"),
  GOMODCACHE: process.env.GOMODCACHE ?? path.join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", "go-mod"),
  CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
};

const child =
  process.platform === "win32"
    ? spawn("go", ["run", ".", ...args], {
        cwd: goOnboardDir,
        stdio: "inherit",
        env,
      })
    : spawn("bash", [path.join(rootDir, "scripts", "onboard-go.sh"), ...args], {
        cwd: rootDir,
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(`onboard launcher failed: ${err.message}`);
  process.exit(1);
});
