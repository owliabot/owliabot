/**
 * Unit tests for initDevWorkspace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:readline", () => ({ createInterface: vi.fn() }));
vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

const mockEnsureWorkspaceInitialized = vi.fn();
const mockMaybeUpdatePolicy = vi.fn();

vi.mock("../../workspace/init.js", () => ({
  ensureWorkspaceInitialized: (...args: any[]) => mockEnsureWorkspaceInitialized(...args),
}));

vi.mock("../steps/policy-allowed-users.js", () => ({
  maybeUpdateWorkspacePolicyAllowedUsers: (...args: any[]) => mockMaybeUpdatePolicy(...args),
}));

import { initDevWorkspace } from "../steps/init-dev-workspace.js";

describe("initDevWorkspace step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockEnsureWorkspaceInitialized.mockResolvedValue({
      workspacePath: "/test/workspace",
      templatesDir: "/templates",
      brandNew: true,
      wroteBootstrap: true,
      copiedSkills: true,
      skillsDir: "/test/workspace/skills",
      created: [],
      skippedExisting: [],
    });
    mockMaybeUpdatePolicy.mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("initDevWorkspace", () => {
    it("calls ensureWorkspaceInitialized with workspace path", async () => {
      await initDevWorkspace("/home/user/.owliabot/workspace", null);
      expect(mockEnsureWorkspaceInitialized).toHaveBeenCalledWith({
        workspacePath: "/home/user/.owliabot/workspace",
      });
    });

    it("calls maybeUpdateWorkspacePolicyAllowedUsers", async () => {
      await initDevWorkspace("/home/user/.owliabot/workspace", ["user1"]);
      expect(mockMaybeUpdatePolicy).toHaveBeenCalledWith(
        "/home/user/.owliabot/workspace",
        ["user1"],
      );
    });

    it("logs success when bootstrap was written", async () => {
      await initDevWorkspace("/home/user/.owliabot/workspace", null);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("BOOTSTRAP.md"));
    });

    it("logs skills copy when copiedSkills is true", async () => {
      await initDevWorkspace("/home/user/.owliabot/workspace", null);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("skills"));
    });

    it("does not log bootstrap when wroteBootstrap is false", async () => {
      mockEnsureWorkspaceInitialized.mockResolvedValue({
        workspacePath: "/test/workspace",
        templatesDir: "/templates",
        brandNew: false,
        wroteBootstrap: false,
        copiedSkills: false,
        skillsDir: null,
        created: [],
        skippedExisting: [],
      });
      await initDevWorkspace("/existing/workspace", null);
      const calls = consoleSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c: string) => c.includes("BOOTSTRAP.md"))).toBe(false);
    });
  });
});
