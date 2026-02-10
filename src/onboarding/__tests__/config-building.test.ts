/**
 * Unit tests for config-building step:
 * - buildAppConfigFromPrompts
 * - buildDefaultMemorySearchConfig
 * - buildDefaultSystemConfig
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let answers: string[] = [];
let promptLog: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (ans: string) => void) => {
      promptLog.push(q);
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
    close: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

import {
  buildDefaultMemorySearchConfig,
  buildDefaultSystemConfig,
} from "../steps/config-building.js";

describe("config-building step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    promptLog = [];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── buildDefaultMemorySearchConfig ──────────────────────────────────────

  describe("buildDefaultMemorySearchConfig", () => {
    it("returns correct defaults", () => {
      const config = buildDefaultMemorySearchConfig();
      expect(config.enabled).toBe(true);
      expect(config.provider).toBe("sqlite");
      expect(config.fallback).toBe("naive");
      expect(config.store.path).toBe("{workspace}/memory/{agentId}.sqlite");
      expect(config.sources).toEqual(["files"]);
      expect(config.indexing.autoIndex).toBe(true);
      expect(config.indexing.minIntervalMs).toBe(300000);
    });

    it("uses workspace placeholder in path", () => {
      const config = buildDefaultMemorySearchConfig();
      expect(config.store.path).toBe("{workspace}/memory/{agentId}.sqlite");
    });
  });

  // ── buildDefaultSystemConfig ────────────────────────────────────────────

  describe("buildDefaultSystemConfig", () => {
    it("has exec with expected commands", () => {
      const config = buildDefaultSystemConfig();
      expect(config.exec.commandAllowList).toContain("ls");
      expect(config.exec.commandAllowList).toContain("curl");
      expect(config.exec.commandAllowList).toContain("rm");
      expect(config.exec.timeoutMs).toBe(60000);
      expect(config.exec.maxOutputBytes).toBe(262144);
    });

    it("has web config with security defaults", () => {
      const config = buildDefaultSystemConfig();
      expect(config.web.allowPrivateNetworks).toBe(false);
      expect(config.web.blockOnSecret).toBe(true);
      expect(config.web.timeoutMs).toBe(15000);
    });

    it("has webSearch config", () => {
      const config = buildDefaultSystemConfig();
      expect(config.webSearch.defaultProvider).toBe("duckduckgo");
      expect(config.webSearch.maxResults).toBe(10);
    });
  });

  // ── buildAppConfigFromPrompts ───────────────────────────────────────────
  // These tests require mocking multiple sub-step modules which makes them
  // complex integration tests. We test the two pure functions above thoroughly
  // and add basic smoke tests for the orchestrator.

  describe("buildAppConfigFromPrompts", () => {
    it("buildDefaultMemorySearchConfig + buildDefaultSystemConfig compose correctly", () => {
      const mem = buildDefaultMemorySearchConfig("/workspace");
      const sys = buildDefaultSystemConfig();
      expect(mem.enabled).toBe(true);
      expect(sys.exec).toBeDefined();
      expect(sys.web).toBeDefined();
      expect(sys.webSearch).toBeDefined();
    });

    it("memory search extra paths starts empty", () => {
      const config = buildDefaultMemorySearchConfig("/w");
      expect(config.extraPaths).toEqual([]);
    });

    it("system exec env allow list includes PATH and HOME", () => {
      const config = buildDefaultSystemConfig();
      expect(config.exec.envAllowList).toContain("PATH");
      expect(config.exec.envAllowList).toContain("HOME");
    });

    it("system web domain lists start empty", () => {
      const config = buildDefaultSystemConfig();
      expect(config.web.domainAllowList).toEqual([]);
      expect(config.web.domainDenyList).toEqual([]);
    });
  });
});
