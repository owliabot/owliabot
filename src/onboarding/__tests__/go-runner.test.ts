import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  buildGoOnboardArgs,
  resolveGoOnboardCommand,
  runGoOnboarding,
  type GoOnboardOptions,
} from "../go-runner.js";

function createMockChild() {
  return new EventEmitter();
}

describe("go-runner", () => {
  it("buildGoOnboardArgs only includes provided options", () => {
    const options: GoOnboardOptions = {
      configDir: " /tmp/config ",
      outputDir: "",
      image: "ghcr.io/owliabot/owliabot:latest",
    };

    expect(buildGoOnboardArgs(options)).toEqual([
      "--config-dir",
      "/tmp/config",
      "--image",
      "ghcr.io/owliabot/owliabot:latest",
    ]);
  });

  it("resolveGoOnboardCommand chooses bash script on unix when script exists", () => {
    const command = resolveGoOnboardCommand({
      platform: "darwin",
      rootDir: "/repo",
      scriptExists: true,
    });

    expect(command).toEqual({
      cmd: "bash",
      args: ["/repo/scripts/onboard-go.sh"],
    });
  });

  it("resolveGoOnboardCommand chooses go run on windows", () => {
    const command = resolveGoOnboardCommand({
      platform: "win32",
      rootDir: "C:\\repo",
      scriptExists: true,
    });

    expect(command).toEqual({
      cmd: "go",
      args: ["run", "./go-onboard"],
    });
  });

  it("runGoOnboarding spawns resolved command with inherited stdio and args", async () => {
    const child = createMockChild();
    const spawnMock = vi.fn(() => child as any);

    const runPromise = runGoOnboarding(
      { configDir: "/tmp/config", image: "ghcr.io/owliabot/owliabot:latest" },
      {
        spawn: spawnMock as any,
        platform: "darwin",
        rootDir: "/repo",
        scriptExists: true,
        allowSourceFallback: true,
        resolveBinaryCommand: async () => null,
      },
    );

    setImmediate(() => {
      child.emit("close", 0);
    });

    await expect(runPromise).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      [
        "/repo/scripts/onboard-go.sh",
        "--config-dir",
        "/tmp/config",
        "--image",
        "ghcr.io/owliabot/owliabot:latest",
      ],
      expect.objectContaining({
        cwd: "/repo",
        stdio: "inherit",
      }),
    );
  });

  it("runGoOnboarding rejects when child exits with non-zero code", async () => {
    const child = createMockChild();
    const spawnMock = vi.fn(() => child as any);

    const runPromise = runGoOnboarding(
      {},
      {
        spawn: spawnMock as any,
        platform: "darwin",
        rootDir: "/repo",
        scriptExists: true,
        allowSourceFallback: true,
        resolveBinaryCommand: async () => null,
      },
    );

    setImmediate(() => {
      child.emit("close", 2);
    });

    await expect(runPromise).rejects.toThrow("go onboard exited with code 2");
  });

  it("runGoOnboarding prefers resolved binary command when available", async () => {
    const child = createMockChild();
    const spawnMock = vi.fn(() => child as any);

    const runPromise = runGoOnboarding(
      {},
      {
        spawn: spawnMock as any,
        platform: "linux",
        rootDir: "/repo",
        scriptExists: true,
        allowSourceFallback: false,
        resolveBinaryCommand: async () => ({ cmd: "/tmp/onboard-bin", args: [] }),
      },
    );

    setImmediate(() => {
      child.emit("close", 0);
    });

    await expect(runPromise).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "/tmp/onboard-bin",
      [],
      expect.objectContaining({
        cwd: "/repo",
        stdio: "inherit",
      }),
    );
  });
});
