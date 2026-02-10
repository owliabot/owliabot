/**
 * Unit tests for detect-existing step functions:
 * - detectExistingConfig
 * - printExistingConfigSummary
 * - promptReuseExistingConfig
 *
 * These functions are NOT exported from onboard.ts. Tests are written for
 * post-refactor when they will be exported as a step module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DetectedConfig } from "./test-helpers.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, existsSync: vi.fn(() => false) };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detect-existing step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── detectExistingConfig ────────────────────────────────────────────────

  describe("detectExistingConfig", () => {
    it.skip("requires export after refactor — returns null when no secrets exist", async () => {
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result).toBeNull();
    });

    it.skip("requires export after refactor — detects anthropic API key only", async () => {
      // Mock loadSecrets to return { anthropic: { apiKey: "sk-ant-api03-xxx" } }
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result).toEqual(expect.objectContaining({ anthropicKey: "sk-ant-api03-xxx" }));
      // expect(result?.openaiKey).toBeUndefined();
    });

    it.skip("requires export after refactor — detects openai API key only", async () => {
      // Mock loadSecrets to return { openai: { apiKey: "sk-test" } }
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result).toEqual(expect.objectContaining({ openaiKey: "sk-test" }));
      // expect(result?.anthropicKey).toBeUndefined();
    });

    it.skip("requires export after refactor — detects both providers", async () => {
      // Mock loadSecrets to return both anthropic + openai
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result?.anthropicKey).toBeDefined();
      // expect(result?.openaiKey).toBeDefined();
    });

    it.skip("requires export after refactor — detects anthropic setup-token", async () => {
      // const token = "sk-ant-oat01-" + "a".repeat(68);
      // Mock loadSecrets → { anthropic: { token } }
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result?.anthropicToken).toBe(token);
    });

    it.skip("requires export after refactor — detects OAuth anthropic.json", async () => {
      // Mock existsSync for auth/anthropic.json → true
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result?.hasOAuthAnthro).toBe(true);
    });

    it.skip("requires export after refactor — detects OAuth openai-codex.json", async () => {
      // Mock existsSync for auth/openai-codex.json → true
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result?.hasOAuthCodex).toBe(true);
    });

    it.skip("requires export after refactor — detects discord and telegram tokens", async () => {
      // Mock loadSecrets → { discord: { token: "d-tok" }, telegram: { token: "t-tok" } }
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result?.discordToken).toBe("d-tok");
      // expect(result?.telegramToken).toBe("t-tok");
    });

    it.skip("requires export after refactor — detects gateway token", async () => {
      // Mock loadSecrets → { gateway: { token: "gw-tok" } }
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result?.gatewayToken).toBe("gw-tok");
    });

    it.skip("requires export after refactor — returns null when loadSecrets throws", async () => {
      // Mock loadSecrets to throw
      // const result = await detectExistingConfig(false, "/fake/app.yaml");
      // expect(result).toBeNull();
    });
  });

  // ── printExistingConfigSummary ──────────────────────────────────────────

  describe("printExistingConfigSummary", () => {
    it.skip("requires export after refactor — prints anthropic key truncated (dev mode 15 chars)", () => {
      // const existing: DetectedConfig = { anthropicKey: "sk-ant-api03-verylongkey123456" };
      // printExistingConfigSummary(false, "/fake/app.yaml", existing);
      // expect(consoleSpy).toHaveBeenCalledWith(
      //   expect.stringContaining("sk-ant-api03-ve...")
      // );
    });

    it.skip("requires export after refactor — prints anthropic key truncated (docker mode 10 chars)", () => {
      // const existing: DetectedConfig = { anthropicKey: "sk-ant-api03-verylongkey123456" };
      // printExistingConfigSummary(true, "/fake/app.yaml", existing);
      // expect(consoleSpy).toHaveBeenCalledWith(
      //   expect.stringContaining("sk-ant-api0...")
      // );
    });

    it.skip("requires export after refactor — prints setup-token line", () => {
      // const existing: DetectedConfig = { anthropicToken: "sk-ant-oat01-xxx" };
      // printExistingConfigSummary(false, "/fake/app.yaml", existing);
      // expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("setup-token"));
    });

    it.skip("requires export after refactor — prints OAuth only in docker mode", () => {
      // const existing: DetectedConfig = { hasOAuthAnthro: true, hasOAuthCodex: true };
      // printExistingConfigSummary(false, "/fake/app.yaml", existing);
      // // dev mode: OAuth lines NOT printed
      // printExistingConfigSummary(true, "/fake/app.yaml", existing);
      // // docker mode: OAuth lines printed
    });

    it.skip("requires export after refactor — prints gateway token only in docker mode", () => {
      // const existing: DetectedConfig = { gatewayToken: "abc123" };
      // printExistingConfigSummary(true, "/fake/app.yaml", existing);
      // expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Gateway"));
    });
  });

  // ── promptReuseExistingConfig ───────────────────────────────────────────

  describe("promptReuseExistingConfig", () => {
    it.skip("requires export after refactor — returns false when existing is null", async () => {
      // const result = await promptReuseExistingConfig(rl, null);
      // expect(result).toBe(false);
    });

    it.skip("requires export after refactor — returns true when user answers yes (default)", async () => {
      // Mock rl.question to answer ""  (default is yes)
      // const existing: DetectedConfig = { anthropicKey: "key" };
      // const result = await promptReuseExistingConfig(rl, existing);
      // expect(result).toBe(true);
    });

    it.skip("requires export after refactor — returns false when user answers no", async () => {
      // Mock rl.question to answer "n"
      // const existing: DetectedConfig = { anthropicKey: "key" };
      // const result = await promptReuseExistingConfig(rl, existing);
      // expect(result).toBe(false);
    });
  });
});
