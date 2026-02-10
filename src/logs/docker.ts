/**
 * Docker environment helpers — thin adapter over the shared reader.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { LogSource } from "./reader.js";

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/** Are we running *inside* a Docker container right now? */
export function isInsideDocker(): boolean {
  return existsSync("/.dockerenv") || process.env.OWLIABOT_DOCKER === "1";
}

/** Is the Docker CLI available on this machine? */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await exec("docker", ["info", "--format", "{{.ID}}"]);
    return true;
  } catch {
    return false;
  }
}

/** Check if a container with the given name is running. */
export async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const out = await exec("docker", [
      "ps",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.ID}}",
    ]);
    return out.length > 0;
  } catch {
    return false;
  }
}

/** Build a LogSource for a running Docker container. */
export function dockerSource(container: string): LogSource {
  return { kind: "docker", container };
}
