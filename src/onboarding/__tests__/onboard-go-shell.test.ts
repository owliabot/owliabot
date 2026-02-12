import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const isWindows = process.platform === "win32";
const run = isWindows ? it.skip : it;

describe("scripts/onboard-go.sh", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  run("supports --help in non-interactive mode without /dev/tty rebind", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "owliabot-go-shell-test-"));
    const goPath = join(tempDir, "go");
    await writeFile(
      goPath,
      "#!/usr/bin/env bash\nset -euo pipefail\necho \"MOCK_GO $*\"\n",
      "utf8",
    );
    await chmod(goPath, 0o755);

    const { code, stdout, stderr } = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolveResult) => {
      const child = spawn("bash", [resolve("scripts", "onboard-go.sh"), "--help"], {
        cwd: resolve("."),
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => {
        out += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        err += chunk.toString("utf8");
      });

      child.on("close", (exitCode) => {
        resolveResult({ code: exitCode, stdout: out, stderr: err });
      });
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("MOCK_GO run . --help");
  });
});
