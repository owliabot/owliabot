/**
 * Unit tests for maybeUpdateWorkspacePolicyAllowedUsers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }),
}));
vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

const mockExistsSync = vi.fn(() => true);
const mockReadFileSync = vi.fn(() => "defaults:\n  allowedUsers:\n    - existing\n");
const mockWriteFileSync = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  };
});

import { maybeUpdateWorkspacePolicyAllowedUsers } from "../steps/policy-allowed-users.js";

describe("maybeUpdateWorkspacePolicyAllowedUsers", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("defaults:\n  allowedUsers:\n    - existing\n");
    mockWriteFileSync.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("merges user IDs into existing allowed list", () => {
    maybeUpdateWorkspacePolicyAllowedUsers("/w", ["user1", "user2"]);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("policy.yml"),
      expect.stringContaining("user1"),
      "utf-8",
    );
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("user2");
    expect(written).toContain("existing");
  });

  it("deduplicates user IDs", () => {
    mockReadFileSync.mockReturnValue("defaults:\n  allowedUsers:\n    - user1\n");
    maybeUpdateWorkspacePolicyAllowedUsers("/w", ["user1", "user2"]);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    const matches = written.match(/user1/g);
    expect(matches).toHaveLength(1);
  });

  it("is a no-op when no user IDs provided", () => {
    maybeUpdateWorkspacePolicyAllowedUsers("/w", []);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("is a no-op when allowedUserIds is null", () => {
    maybeUpdateWorkspacePolicyAllowedUsers("/w", null);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("does not throw when policy.yml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => maybeUpdateWorkspacePolicyAllowedUsers("/w", ["user1"])).not.toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
