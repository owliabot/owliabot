import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execAction } from "../actions/exec.js";

describe("system/actions/exec", () => {
  it("executes an allowlisted command inside workspace with sanitized env", async () => {
    const ws = await mkdtemp(join(tmpdir(), "owliabot-ws-"));
    try {
      await writeFile(join(ws, "hello.txt"), "hi", "utf-8");

      const res = await execAction(
        {
          command: "node",
          params: [
            "-e",
            "console.log(process.env.FOO||''); console.log(process.env.SECRET_TOKEN||'')",
          ],
        },
        {
          workspacePath: ws,
          cwd: ".",
          env: { FOO: "bar", SECRET_TOKEN: "nope" },
        },
        {
          commandAllowList: ["node"],
          envAllowList: ["PATH", "FOO", "SECRET_TOKEN"],
          timeoutMs: 30_000,
          maxOutputBytes: 64 * 1024,
        }
      );

      expect(res.exitCode).toBe(0);
      const lines = res.stdout.split("\n");
      expect(lines[0]).toBe("bar");
      // SECRET_TOKEN should be stripped due to sensitive name
      expect(lines[1]).toBe("");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("denies commands not in whitelist", async () => {
    const ws = await mkdtemp(join(tmpdir(), "owliabot-ws-"));
    try {
      await expect(
        execAction(
          { command: "node", params: ["-e", "console.log('x')"] },
          { workspacePath: ws },
          {
            commandAllowList: ["ls"],
            envAllowList: ["PATH"],
            timeoutMs: 10_000,
            maxOutputBytes: 64 * 1024,
          }
        )
      ).rejects.toThrow(/Command not allowed/);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("denies cwd outside workspace", async () => {
    const ws = await mkdtemp(join(tmpdir(), "owliabot-ws-"));
    try {
      await expect(
        execAction(
          { command: "node", params: ["-e", "console.log('x')"] },
          { workspacePath: ws, cwd: "/" },
          {
            commandAllowList: ["node"],
            envAllowList: ["PATH"],
            timeoutMs: 10_000,
            maxOutputBytes: 64 * 1024,
          }
        )
      ).rejects.toThrow(/within workspace/);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
