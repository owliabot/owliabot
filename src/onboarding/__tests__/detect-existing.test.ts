/**
 * Unit tests for detect-existing step functions:
 * - detectExistingConfig
 * - printExistingConfigSummary
 * - promptReuseExistingConfig
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DetectedConfig } from "../steps/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
    pause: vi.fn(),
    resume: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }),
}));

const mockLoadSecrets = vi.fn();
vi.mock("../secrets.js", () => ({
  loadSecrets: (...args: any[]) => mockLoadSecrets(...args),
  saveSecrets: vi.fn(),
}));

const mockExistsSync = vi.fn(() => false);
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, existsSync: (...args: any[]) => mockExistsSync(...args) };
});

vi.mock("../../utils/paths.js", () => ({
  ensureOwliabotHomeEnv: () => "/fake/home/.owliabot",
}));

vi.mock("../../auth/oauth.js", () => ({ startOAuthFlow: vi.fn() }));
vi.mock("../clawlet-onboard.js", () => ({ runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }) }));

import { createInterface } from "node:readline";
import {
  detectExistingConfig,
  printExistingConfigSummary,
  promptReuseExistingConfig,
} from "../steps/detect-existing.js";

describe("detect-existing step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let rl: ReturnType<typeof createInterface>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    promptLog = [];
    mockLoadSecrets.mockReset();
    mockExistsSync.mockReset().mockReturnValue(false);
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── detectExistingConfig ────────────────────────────────────────────────

  describe("detectExistingConfig", () => {
    it("returns null when no secrets exist", async () => {
      mockLoadSecrets.mockResolvedValue(null);
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result).toBeNull();
    });

    it("detects anthropic API key only", async () => {
      mockLoadSecrets.mockResolvedValue({ anthropic: { apiKey: "sk-ant-api03-xxx" } });
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result).toEqual(expect.objectContaining({ anthropicKey: "sk-ant-api03-xxx" }));
      expect(result?.openaiKey).toBeUndefined();
    });

    it("detects openai API key only", async () => {
      mockLoadSecrets.mockResolvedValue({ openai: { apiKey: "sk-test" } });
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result).toEqual(expect.objectContaining({ openaiKey: "sk-test" }));
      expect(result?.anthropicKey).toBeUndefined();
    });

    it("detects both providers", async () => {
      mockLoadSecrets.mockResolvedValue({
        anthropic: { apiKey: "sk-ant" },
        openai: { apiKey: "sk-oai" },
      });
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result?.anthropicKey).toBe("sk-ant");
      expect(result?.openaiKey).toBe("sk-oai");
    });

    it("detects anthropic setup-token", async () => {
      const token = "sk-ant-oat01-" + "a".repeat(68);
      mockLoadSecrets.mockResolvedValue({ anthropic: { token } });
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result?.anthropicToken).toBe(token);
    });

    it("detects OAuth anthropic.json", async () => {
      mockLoadSecrets.mockResolvedValue({});
      mockExistsSync.mockImplementation((p: any) =>
        typeof p === "string" && p.includes("anthropic.json"),
      );
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result?.anthropicOAuth).toBe(true);
    });

    it("detects OAuth openai-codex.json", async () => {
      mockLoadSecrets.mockResolvedValue({});
      mockExistsSync.mockImplementation((p: any) =>
        typeof p === "string" && p.includes("openai-codex.json"),
      );
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result?.openaiOAuth).toBe(true);
    });

    it("detects discord and telegram tokens", async () => {
      mockLoadSecrets.mockResolvedValue({
        discord: { token: "d-tok" },
        telegram: { token: "t-tok" },
      });
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result?.discordToken).toBe("d-tok");
      expect(result?.telegramToken).toBe("t-tok");
    });

    it("detects gateway token", async () => {
      mockLoadSecrets.mockResolvedValue({ gateway: { token: "gw-tok" } });
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result?.gatewayToken).toBe("gw-tok");
    });

    it("returns null when loadSecrets throws", async () => {
      mockLoadSecrets.mockRejectedValue(new Error("fail"));
      const result = await detectExistingConfig(false, "/fake/app.yaml");
      expect(result).toBeNull();
    });
  });

  // ── printExistingConfigSummary ──────────────────────────────────────────

  describe("printExistingConfigSummary", () => {
    it("prints anthropic key truncated (dev mode 15 chars)", () => {
      const existing: DetectedConfig = { anthropicKey: "sk-ant-api03-verylongkey123456" };
      printExistingConfigSummary(false, "/fake/app.yaml", existing);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("sk-ant-api03-ve"),
      );
    });

    it("prints anthropic key truncated (docker mode 10 chars)", () => {
      const existing: DetectedConfig = { anthropicKey: "sk-ant-api03-verylongkey123456" };
      printExistingConfigSummary(true, "/fake/app.yaml", existing);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("sk-ant-api..."),
      );
    });

    it("prints setup-token line", () => {
      const existing: DetectedConfig = { anthropicToken: "sk-ant-oat01-xxx" };
      printExistingConfigSummary(false, "/fake/app.yaml", existing);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("setup-token"));
    });

    it("prints OAuth only in docker mode", () => {
      const existing: DetectedConfig = { anthropicOAuth: true, openaiOAuth: true };
      consoleSpy.mockClear();
      printExistingConfigSummary(false, "/fake/app.yaml", existing);
      const devCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      // OAuth lines only printed in docker mode
      expect(devCalls).not.toContain("OAuth");

      consoleSpy.mockClear();
      printExistingConfigSummary(true, "/fake/app.yaml", existing);
      const dockerCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(dockerCalls).toContain("OAuth");
    });

    it("prints gateway token only in docker mode", () => {
      const existing: DetectedConfig = { gatewayToken: "abc123" };
      consoleSpy.mockClear();
      printExistingConfigSummary(false, "/fake/app.yaml", existing);
      const devCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(devCalls).not.toContain("Gateway");

      consoleSpy.mockClear();
      printExistingConfigSummary(true, "/fake/app.yaml", existing);
      const dockerCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(dockerCalls).toContain("Gateway");
    });
  });

  // ── promptReuseExistingConfig ───────────────────────────────────────────

  describe("promptReuseExistingConfig", () => {
    it("returns false when existing is null", async () => {
      const result = await promptReuseExistingConfig(rl, null);
      expect(result).toBe(false);
    });

    it("returns true when user answers yes (default)", async () => {
      answers = [""];
      const existing: DetectedConfig = { anthropicKey: "key" };
      const result = await promptReuseExistingConfig(rl, existing);
      expect(result).toBe(true);
    });

    it("returns false when user answers no", async () => {
      answers = ["n"];
      const existing: DetectedConfig = { anthropicKey: "key" };
      const result = await promptReuseExistingConfig(rl, existing);
      expect(result).toBe(false);
    });
  });
});
