/**
 * Unit tests for maybeUpdateWorkspacePolicyAllowedUsers.
 *
 * This function updates the workspace policy's allowed user list based on
 * the configured channel tokens / IDs. Security-relevant — ensures the
 * allow-list is correctly derived from config.
 *
 * NOT exported yet — tests are skipped until the refactor exports this function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:readline", () => ({ createInterface: vi.fn() }));
vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

describe("maybeUpdateWorkspacePolicyAllowedUsers", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it.skip("requires export after refactor — adds discord user IDs to allowed list", () => {
    // const config = {
    //   channels: { discord: { allowedUserIds: ["user1", "user2"] } },
    //   workspace: "/w",
    //   system: { capabilities: { writeTools: { allowedUsers: [] } } },
    // };
    // maybeUpdateWorkspacePolicyAllowedUsers(config);
    // expect(config.system.capabilities.writeTools.allowedUsers).toContain("user1");
    // expect(config.system.capabilities.writeTools.allowedUsers).toContain("user2");
  });

  it.skip("requires export after refactor — deduplicates user IDs", () => {
    // const config = {
    //   channels: { discord: { allowedUserIds: ["user1", "user1", "user2"] } },
    //   workspace: "/w",
    //   system: { capabilities: { writeTools: { allowedUsers: ["user1"] } } },
    // };
    // maybeUpdateWorkspacePolicyAllowedUsers(config);
    // const ids = config.system.capabilities.writeTools.allowedUsers;
    // expect(ids.filter((id: string) => id === "user1")).toHaveLength(1);
  });

  it.skip("requires export after refactor — is a no-op when no channel user IDs configured", () => {
    // const config = {
    //   channels: {},
    //   workspace: "/w",
    //   system: { capabilities: { writeTools: { allowedUsers: [] } } },
    // };
    // maybeUpdateWorkspacePolicyAllowedUsers(config);
    // expect(config.system.capabilities.writeTools.allowedUsers).toEqual([]);
  });

  it.skip("requires export after refactor — filters out empty and whitespace-only IDs", () => {
    // const config = {
    //   channels: { discord: { allowedUserIds: ["user1", "", "  ", "user2"] } },
    //   workspace: "/w",
    //   system: { capabilities: { writeTools: { allowedUsers: [] } } },
    // };
    // maybeUpdateWorkspacePolicyAllowedUsers(config);
    // const ids = config.system.capabilities.writeTools.allowedUsers;
    // expect(ids).toEqual(["user1", "user2"]);
  });

  it.skip("requires export after refactor — handles missing writeTools config gracefully", () => {
    // const config = {
    //   channels: { discord: { allowedUserIds: ["user1"] } },
    //   workspace: "/w",
    //   system: {},
    // };
    // // Should not throw
    // expect(() => maybeUpdateWorkspacePolicyAllowedUsers(config)).not.toThrow();
  });
});
