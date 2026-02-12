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

  it("resolveGoOnboardCommand uses go run in client module", () => {
    const command = resolveGoOnboardCommand({
      rootDir: "C:\\repo",
    });

    expect(command).toEqual({
      cmd: "go",
      args: ["-C", "C:\\repo/client", "run", "."],
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
        allowSourceFallback: true,
        resolveBinaryCommand: async () => null,
      },
    );

    setImmediate(() => {
      child.emit("close", 0);
    });

    await expect(runPromise).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "go",
      [
        "-C",
        "/repo/client",
        "run",
        ".",
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
        allowSourceFallback: true,
        resolveBinaryCommand: async () => null,
      },
    );

    setImmediate(() => {
      child.emit("close", 2);
    });

    await expect(runPromise).rejects.toThrow("go onboard exited with code 2");
  });

  it("runGoOnboarding sets CGO_ENABLED=0 for darwin source fallback", async () => {
    const child = createMockChild();
    const spawnMock = vi.fn(() => child as any);

    const runPromise = runGoOnboarding(
      {},
      {
        spawn: spawnMock as any,
        platform: "darwin",
        rootDir: "/repo",
        allowSourceFallback: true,
        resolveBinaryCommand: async () => null,
      },
    );

    setImmediate(() => {
      child.emit("close", 0);
    });

    await expect(runPromise).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const spawnOptions = spawnMock.mock.calls[0]?.[2];
    expect(spawnOptions?.env?.CGO_ENABLED).toBe("0");
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
