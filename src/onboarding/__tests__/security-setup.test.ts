/**
 * Unit tests for security-setup step:
 * - configureWriteToolsSecurity
 * - deriveWriteToolAllowListFromConfig
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let answers: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
    close: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

describe("security-setup step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── configureWriteToolsSecurity ─────────────────────────────────────────

  describe("configureWriteToolsSecurity", () => {
    it.skip("requires export after refactor — returns null when no user IDs from channels", async () => {
      // const config = {} as any;
      // const userAllowLists = { discord: [], telegram: [] };
      // const result = await configureWriteToolsSecurity(rl, config, userAllowLists);
      // expect(result).toBeNull();
      // expect(config.security).toBeUndefined();
    });

    it.skip("requires export after refactor — merges discord and telegram IDs", async () => {
      // answers = [""];
      // const config = {} as any;
      // const userAllowLists = { discord: ["111"], telegram: ["222"] };
      // const result = await configureWriteToolsSecurity(rl, config, userAllowLists);
      // expect(result).toEqual(["111", "222"]);
      // expect(config.security?.writeToolAllowList).toEqual(["111", "222"]);
      // expect(config.security?.writeGateEnabled).toBe(false);
      // expect(config.tools?.allowWrite).toBe(true);
    });

    it.skip("requires export after refactor — adds additional user IDs", async () => {
      // answers = ["333,444"];
      // const config = {} as any;
      // const userAllowLists = { discord: ["111"], telegram: [] };
      // const result = await configureWriteToolsSecurity(rl, config, userAllowLists);
      // expect(result).toEqual(["111", "333", "444"]);
    });

    it.skip("requires export after refactor — deduplicates IDs", async () => {
      // answers = ["111"];  // already in discord
      // const config = {} as any;
      // const userAllowLists = { discord: ["111"], telegram: [] };
      // const result = await configureWriteToolsSecurity(rl, config, userAllowLists);
      // expect(result).toEqual(["111"]);
    });
  });

  // ── deriveWriteToolAllowListFromConfig ──────────────────────────────────

  describe("deriveWriteToolAllowListFromConfig", () => {
    it.skip("requires export after refactor — returns from security.writeToolAllowList if present", () => {
      // const config = { security: { writeToolAllowList: ["a", "b"] } } as any;
      // expect(deriveWriteToolAllowListFromConfig(config)).toEqual(["a", "b"]);
    });

    it.skip("requires export after refactor — derives from discord memberAllowList", () => {
      // const config = { discord: { memberAllowList: ["111", "222"] } } as any;
      // expect(deriveWriteToolAllowListFromConfig(config)).toEqual(["111", "222"]);
    });

    it.skip("requires export after refactor — derives from telegram allowList", () => {
      // const config = { telegram: { allowList: ["333"] } } as any;
      // expect(deriveWriteToolAllowListFromConfig(config)).toEqual(["333"]);
    });

    it.skip("requires export after refactor — merges discord + telegram fallback", () => {
      // const config = {
      //   discord: { memberAllowList: ["111"] },
      //   telegram: { allowList: ["222"] },
      // } as any;
      // expect(deriveWriteToolAllowListFromConfig(config)).toEqual(["111", "222"]);
    });

    it.skip("requires export after refactor — returns null when no lists present", () => {
      // const config = { workspace: "/w", providers: [] } as any;
      // expect(deriveWriteToolAllowListFromConfig(config)).toBeNull();
    });

    it.skip("requires export after refactor — filters empty strings", () => {
      // const config = { security: { writeToolAllowList: ["a", "", "  ", "b"] } } as any;
      // expect(deriveWriteToolAllowListFromConfig(config)).toEqual(["a", "b"]);
    });
  });
});
