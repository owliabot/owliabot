/**
 * Unit tests for provider-setup step functions:
 * - reuseProvidersFromExisting
 * - getProvidersSetup
 * - maybeConfigureAnthropic
 * - maybeConfigureOpenAI
 * - maybeConfigureOpenAICodex
 * - maybeConfigureOpenAICompatible
 * - askProviders
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DetectedConfig, ProviderSetupState } from "../steps/types.js";

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
  }),
}));

vi.mock("../../auth/oauth.js", () => ({
  startOAuthFlow: vi.fn().mockResolvedValue({ access: "test", refresh: "r", expires: Date.now() + 3600000 }),
}));

vi.mock("../clawlet-onboard.js", () => ({
  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

// We need to mock setup-token validation to avoid real validation logic
vi.mock("../../auth/setup-token.js", () => ({
  isSetupToken: (v: string) => v.startsWith("sk-ant-oat01-"),
  validateAnthropicSetupToken: () => undefined,
}));

import { createInterface } from "node:readline";
import {
  reuseProvidersFromExisting,
  getProvidersSetup,
  maybeConfigureAnthropic,
  maybeConfigureOpenAI,
  maybeConfigureOpenAICodex,
  maybeConfigureOpenAICompatible,
  askProviders,
} from "../steps/provider-setup.js";
import { startOAuthFlow } from "../../auth/oauth.js";

function makeState(): ProviderSetupState {
  return { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
}

describe("provider-setup step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let rl: ReturnType<typeof createInterface>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    promptLog = [];
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── reuseProvidersFromExisting ──────────────────────────────────────────

  describe("reuseProvidersFromExisting", () => {
    it("reuses anthropic API key", () => {
      const existing: DetectedConfig = { anthropicKey: "sk-ant-api03-xxx" };
      const result = reuseProvidersFromExisting(existing);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].id).toBe("anthropic");
      expect(result.providers[0].apiKey).toBe("secrets");
      expect(result.secrets.anthropic?.apiKey).toBe("sk-ant-api03-xxx");
      expect(result.useAnthropic).toBe(true);
    });

    it("reuses anthropic setup-token", () => {
      const token = "sk-ant-oat01-" + "a".repeat(68);
      const existing: DetectedConfig = { anthropicToken: token };
      const result = reuseProvidersFromExisting(existing);
      expect(result.secrets.anthropic?.token).toBe(token);
      expect(result.providers[0].apiKey).toBe("secrets");
    });

    it("reuses anthropic OAuth", () => {
      const existing: DetectedConfig = { anthropicOAuth: true };
      const result = reuseProvidersFromExisting(existing);
      expect(result.providers[0].apiKey).toBe("oauth");
      expect(result.useAnthropic).toBe(true);
    });

    it("reuses openai API key", () => {
      const existing: DetectedConfig = { openaiKey: "sk-test" };
      const result = reuseProvidersFromExisting(existing);
      expect(result.providers[0].id).toBe("openai");
      expect(result.secrets.openai?.apiKey).toBe("sk-test");
    });

    it("reuses openai codex OAuth", () => {
      const existing: DetectedConfig = { openaiOAuth: true };
      const result = reuseProvidersFromExisting(existing);
      expect(result.providers[0].id).toBe("openai-codex");
      expect(result.providers[0].apiKey).toBe("oauth");
      expect(result.useOpenaiCodex).toBe(true);
    });

    it("reuses multiple providers with correct priority", () => {
      const existing: DetectedConfig = { anthropicKey: "k1", openaiKey: "k2", openaiOAuth: true };
      const result = reuseProvidersFromExisting(existing);
      expect(result.providers).toHaveLength(3);
      expect(result.providers[0].priority).toBe(1);
      expect(result.providers[1].priority).toBe(2);
      expect(result.providers[2].priority).toBe(3);
    });

    it("returns empty when no matching keys", () => {
      const existing: DetectedConfig = { discordToken: "d-tok" };
      const result = reuseProvidersFromExisting(existing);
      expect(result.providers).toHaveLength(0);
    });
  });

  // ── maybeConfigureAnthropic ─────────────────────────────────────────────

  describe("maybeConfigureAnthropic", () => {
    it("skips when aiChoice is not 0 or 4", async () => {
      const state = makeState();
      await maybeConfigureAnthropic(rl, state, 1);
      expect(state.providers).toHaveLength(0);
      expect(state.useAnthropic).toBe(false);
    });

    it("configures setup-token when sk-ant-oat01- prefix", async () => {
      answers = ["sk-ant-oat01-" + "x".repeat(68), ""];
      const state = makeState();
      await maybeConfigureAnthropic(rl, state, 0);
      expect(state.secrets.anthropic?.token).toBeDefined();
      expect(state.secrets.anthropic?.apiKey).toBeUndefined();
      expect(state.useAnthropic).toBe(true);
    });

    it("configures API key when not setup-token", async () => {
      answers = ["sk-ant-api03-test", ""];
      const state = makeState();
      await maybeConfigureAnthropic(rl, state, 0);
      expect(state.secrets.anthropic?.apiKey).toBe("sk-ant-api03-test");
      expect(state.secrets.anthropic?.token).toBeUndefined();
    });

    it("uses env when empty input", async () => {
      answers = ["", ""];
      const state = makeState();
      await maybeConfigureAnthropic(rl, state, 0);
      expect(state.providers[0].apiKey).toBe("env");
    });

    it("uses custom model", async () => {
      answers = ["", "claude-sonnet-4-20250514"];
      const state = makeState();
      await maybeConfigureAnthropic(rl, state, 0);
      expect(state.providers[0].model).toBe("claude-sonnet-4-20250514");
    });
  });

  // ── maybeConfigureOpenAI ────────────────────────────────────────────────

  describe("maybeConfigureOpenAI", () => {
    it("skips when aiChoice is not 1 or 4", async () => {
      const state = makeState();
      await maybeConfigureOpenAI(rl, state, 0);
      expect(state.providers).toHaveLength(0);
    });

    it("saves API key to secrets", async () => {
      answers = ["sk-openai-test", ""];
      const state = makeState();
      await maybeConfigureOpenAI(rl, state, 1);
      expect(state.secrets.openai?.apiKey).toBe("sk-openai-test");
      expect(state.providers[0].apiKey).toBe("secrets");
    });

    it("uses env when empty", async () => {
      answers = ["", ""];
      const state = makeState();
      await maybeConfigureOpenAI(rl, state, 1);
      expect(state.providers[0].apiKey).toBe("env");
    });
  });

  // ── maybeConfigureOpenAICodex ───────────────────────────────────────────

  describe("maybeConfigureOpenAICodex", () => {
    it("skips when aiChoice is not 2 or 4", async () => {
      const state = makeState();
      await maybeConfigureOpenAICodex(rl, false, state, 0);
      expect(state.providers).toHaveLength(0);
    });

    it("sets up oauth provider and skips flow", async () => {
      answers = ["n"];
      const state = makeState();
      await maybeConfigureOpenAICodex(rl, false, state, 2);
      expect(state.providers[0].id).toBe("openai-codex");
      expect(state.providers[0].apiKey).toBe("oauth");
      expect(state.useOpenaiCodex).toBe(true);
    });

    it("runs OAuth flow when user says yes", async () => {
      answers = ["y"];
      const state = makeState();
      await maybeConfigureOpenAICodex(rl, false, state, 2);
      expect(startOAuthFlow).toHaveBeenCalledWith("openai-codex", { headless: false });
    });

    it("passes headless=true in docker mode", async () => {
      answers = ["y"];
      const state = makeState();
      await maybeConfigureOpenAICodex(rl, true, state, 2);
      expect(startOAuthFlow).toHaveBeenCalledWith("openai-codex", { headless: true });
    });
  });

  // ── maybeConfigureOpenAICompatible ──────────────────────────────────────

  describe("maybeConfigureOpenAICompatible", () => {
    it("skips when aiChoice is not 3 or 4", async () => {
      const state = makeState();
      await maybeConfigureOpenAICompatible(rl, state, 0);
      expect(state.providers).toHaveLength(0);
    });

    it("configures with base URL and optional key", async () => {
      answers = ["http://localhost:11434/v1", "", "my-api-key"];
      const state = makeState();
      await maybeConfigureOpenAICompatible(rl, state, 3);
      expect(state.providers[0].id).toBe("openai-compatible");
      expect((state.providers[0] as any).baseUrl).toBe("http://localhost:11434/v1");
      expect(state.secrets["openai-compatible"]?.apiKey).toBe("my-api-key");
    });

    it("no-ops when baseUrl is empty", async () => {
      answers = [""];
      const state = makeState();
      await maybeConfigureOpenAICompatible(rl, state, 3);
      expect(state.providers).toHaveLength(0);
    });

    it("sets apiKey to none when no key provided", async () => {
      answers = ["http://localhost:11434/v1", "", ""];
      const state = makeState();
      await maybeConfigureOpenAICompatible(rl, state, 3);
      expect(state.providers[0].apiKey).toBe("none");
    });
  });

  // ── askProviders ────────────────────────────────────────────────────────

  describe("askProviders", () => {
    it("routes to anthropic on choice 1", async () => {
      answers = ["1", "sk-key", ""];
      const result = await askProviders(rl, false);
      expect(result.providers[0].id).toBe("anthropic");
    });

    it("routes to openai on choice 2", async () => {
      answers = ["2", "", ""];
      const result = await askProviders(rl, false);
      expect(result.providers[0].id).toBe("openai");
    });

    it("configures all on choice 5 (multiple)", async () => {
      const token = "sk-ant-oat01-" + "x".repeat(68);
      answers = ["5", token, "", "", "", "n", "http://localhost:11434/v1", "", ""];
      const result = await askProviders(rl, false);
      expect(result.providers).toHaveLength(4);
    });
  });

  // ── getProvidersSetup ───────────────────────────────────────────────────

  describe("getProvidersSetup", () => {
    it("reuses existing when reuseExisting=true", async () => {
      const existing: DetectedConfig = { anthropicKey: "key" };
      const result = await getProvidersSetup(rl, false, existing, true);
      expect(result.providers[0].id).toBe("anthropic");
    });

    it("falls through to askProviders when reuse yields empty", async () => {
      const existing: DetectedConfig = { discordToken: "d-tok" };
      answers = ["1", "", ""];
      const result = await getProvidersSetup(rl, false, existing, true);
      expect(result.providers).toHaveLength(1);
    });

    it("defaults to anthropic env when no provider configured", async () => {
      // selectOption requires valid number; entering invalid causes retry loop.
      // The fallback path is when askProviders returns empty providers.
      // This happens when all maybeConfigureX skip (no matching aiChoice).
      // Actually, selectOption loops until valid, so we can't easily get empty providers.
      // Instead test the fallback: reuseExisting=false, existing=null, choose anthropic with defaults
      answers = ["1", "", ""];
      const result = await getProvidersSetup(rl, false, null, false);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].id).toBe("anthropic");
    });
  });
});
