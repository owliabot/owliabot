/**
 * Unit tests for initDevWorkspace and tryMakeTreeWritableForDocker.
 *
 * initDevWorkspace creates the workspace directory structure for dev mode.
 * tryMakeTreeWritableForDocker recursively chmod's a tree for docker access.
 *
 * NOT exported yet — tests are skipped until the refactor exports these functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:readline", () => ({ createInterface: vi.fn() }));
vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    chmodSync: vi.fn(),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
  };
});

describe("initDevWorkspace step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("initDevWorkspace", () => {
    it.skip("requires export after refactor — creates workspace directory if it does not exist", async () => {
      // const { mkdir } = await import("node:fs/promises");
      // await initDevWorkspace("/home/user/.owliabot/workspace");
      // expect(mkdir).toHaveBeenCalledWith("/home/user/.owliabot/workspace", { recursive: true });
    });

    it.skip("requires export after refactor — is a no-op when directory already exists", async () => {
      // const fs = await import("node:fs");
      // vi.mocked(fs.existsSync).mockReturnValue(true);
      // const { mkdir } = await import("node:fs/promises");
      // await initDevWorkspace("/existing/workspace");
      // expect(mkdir).not.toHaveBeenCalled();
    });

    it.skip("requires export after refactor — creates AGENTS.md template in new workspace", async () => {
      // const { writeFile } = await import("node:fs/promises");
      // await initDevWorkspace("/home/user/.owliabot/workspace");
      // expect(writeFile).toHaveBeenCalledWith(
      //   expect.stringContaining("AGENTS.md"),
      //   expect.any(String),
      // );
    });
  });

  describe("tryMakeTreeWritableForDocker", () => {
    it.skip("requires export after refactor — chmod's files recursively", () => {
      // const fs = await import("node:fs");
      // vi.mocked(fs.readdirSync).mockReturnValue(["file1.txt", "subdir"] as any);
      // vi.mocked(fs.statSync)
      //   .mockReturnValueOnce({ isDirectory: () => false } as any)
      //   .mockReturnValueOnce({ isDirectory: () => true } as any);
      // tryMakeTreeWritableForDocker("/root");
      // expect(fs.chmodSync).toHaveBeenCalled();
    });

    it.skip("requires export after refactor — does not throw on permission errors", () => {
      // const fs = await import("node:fs");
      // vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error("EACCES"); });
      // expect(() => tryMakeTreeWritableForDocker("/locked")).not.toThrow();
    });
  });
});
