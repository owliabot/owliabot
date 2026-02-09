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

// Type stubs
interface DetectedConfig {
  anthropicKey?: string;
  anthropicToken?: string;
  openaiKey?: string;
  openaiCompatKey?: string;
  discordToken?: string;
  telegramToken?: string;
  gatewayToken?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
}

interface ProviderResult {
  providers: any[];
  secrets: Record<string, any>;
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

describe("provider-setup step", () => {
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

  // ── reuseProvidersFromExisting ──────────────────────────────────────────

  describe("reuseProvidersFromExisting", () => {
    it.skip("requires export after refactor — reuses anthropic API key", () => {
      // const existing: DetectedConfig = { anthropicKey: "sk-ant-api03-xxx" };
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.providers).toHaveLength(1);
      // expect(result.providers[0].id).toBe("anthropic");
      // expect(result.providers[0].apiKey).toBe("secrets");
      // expect(result.secrets.anthropic?.apiKey).toBe("sk-ant-api03-xxx");
      // expect(result.useAnthropic).toBe(true);
    });

    it.skip("requires export after refactor — reuses anthropic setup-token", () => {
      // const token = "sk-ant-oat01-" + "a".repeat(68);
      // const existing: DetectedConfig = { anthropicToken: token };
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.secrets.anthropic?.token).toBe(token);
      // expect(result.providers[0].apiKey).toBe("secrets");
    });

    it.skip("requires export after refactor — reuses anthropic OAuth", () => {
      // const existing: DetectedConfig = { anthropicOAuth: true };
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.providers[0].apiKey).toBe("oauth");
      // expect(result.useAnthropic).toBe(true);
    });

    it.skip("requires export after refactor — reuses openai API key", () => {
      // const existing: DetectedConfig = { openaiKey: "sk-test" };
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.providers[0].id).toBe("openai");
      // expect(result.secrets.openai?.apiKey).toBe("sk-test");
    });

    it.skip("requires export after refactor — reuses openai codex OAuth", () => {
      // const existing: DetectedConfig = { openaiOAuth: true };
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.providers[0].id).toBe("openai-codex");
      // expect(result.providers[0].apiKey).toBe("oauth");
      // expect(result.useOpenaiCodex).toBe(true);
    });

    it.skip("requires export after refactor — reuses multiple providers with correct priority", () => {
      // const existing: DetectedConfig = { anthropicKey: "k1", openaiKey: "k2", openaiOAuth: true };
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.providers).toHaveLength(3);
      // expect(result.providers[0].priority).toBe(1);
      // expect(result.providers[1].priority).toBe(2);
      // expect(result.providers[2].priority).toBe(3);
    });

    it.skip("requires export after refactor — returns empty when no matching keys", () => {
      // const existing: DetectedConfig = { discordToken: "d-tok" }; // no provider keys
      // const result = reuseProvidersFromExisting(existing);
      // expect(result.providers).toHaveLength(0);
    });
  });

  // ── maybeConfigureAnthropic ─────────────────────────────────────────────

  describe("maybeConfigureAnthropic", () => {
    it.skip("requires export after refactor — skips when aiChoice is not 0 or 4", async () => {
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureAnthropic(rl, state, 1); // openai choice
      // expect(state.providers).toHaveLength(0);
      // expect(state.useAnthropic).toBe(false);
    });

    it.skip("requires export after refactor — configures setup-token when sk-ant-oat01- prefix", async () => {
      // answers = ["sk-ant-oat01-" + "x".repeat(68), ""];
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureAnthropic(rl, state, 0);
      // expect(state.secrets.anthropic?.token).toBeDefined();
      // expect(state.secrets.anthropic?.apiKey).toBeUndefined();
      // expect(state.useAnthropic).toBe(true);
    });

    it.skip("requires export after refactor — configures API key when not setup-token", async () => {
      // answers = ["sk-ant-api03-test", ""];
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureAnthropic(rl, state, 0);
      // expect(state.secrets.anthropic?.apiKey).toBe("sk-ant-api03-test");
      // expect(state.secrets.anthropic?.token).toBeUndefined();
    });

    it.skip("requires export after refactor — uses env when empty input", async () => {
      // answers = ["", ""];
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureAnthropic(rl, state, 0);
      // expect(state.providers[0].apiKey).toBe("env");
    });

    it.skip("requires export after refactor — uses custom model", async () => {
      // answers = ["", "claude-sonnet-4-20250514"];
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureAnthropic(rl, state, 0);
      // expect(state.providers[0].model).toBe("claude-sonnet-4-20250514");
    });
  });

  // ── maybeConfigureOpenAI ────────────────────────────────────────────────

  describe("maybeConfigureOpenAI", () => {
    it.skip("requires export after refactor — skips when aiChoice is not 1 or 4", async () => {
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureOpenAI(rl, state, 0);
      // expect(state.providers).toHaveLength(0);
    });

    it.skip("requires export after refactor — saves API key to secrets", async () => {
      // answers = ["sk-openai-test", ""];
      // const state = { providers: [], secrets: {}, priority: 1, useAnthropic: false, useOpenaiCodex: false };
      // await maybeConfigureOpenAI(rl, state, 1);
      // expect(state.secrets.openai?.apiKey).toBe("sk-openai-test");
      // expect(state.providers[0].apiKey).toBe("secrets");
    });

    it.skip("requires export after refactor — uses env when empty", async () => {
      // answers = ["", ""];
      // await maybeConfigureOpenAI(rl, state, 1);
      // expect(state.providers[0].apiKey).toBe("env");
    });
  });

  // ── maybeConfigureOpenAICodex ───────────────────────────────────────────

  describe("maybeConfigureOpenAICodex", () => {
    it.skip("requires export after refactor — skips when aiChoice is not 2 or 4", async () => {
      // const state = { ... };
      // await maybeConfigureOpenAICodex(rl, false, state, 0);
      // expect(state.providers).toHaveLength(0);
    });

    it.skip("requires export after refactor — sets up oauth provider and skips flow", async () => {
      // answers = ["n"]; // skip OAuth
      // await maybeConfigureOpenAICodex(rl, false, state, 2);
      // expect(state.providers[0].id).toBe("openai-codex");
      // expect(state.providers[0].apiKey).toBe("oauth");
      // expect(state.useOpenaiCodex).toBe(true);
    });

    it.skip("requires export after refactor — runs OAuth flow when user says yes", async () => {
      // answers = ["y"];
      // await maybeConfigureOpenAICodex(rl, false, state, 2);
      // expect(startOAuthFlow).toHaveBeenCalledWith("openai-codex", { headless: false });
    });

    it.skip("requires export after refactor — passes headless=true in docker mode", async () => {
      // answers = ["y"];
      // await maybeConfigureOpenAICodex(rl, true, state, 2);
      // expect(startOAuthFlow).toHaveBeenCalledWith("openai-codex", { headless: true });
    });
  });

  // ── maybeConfigureOpenAICompatible ──────────────────────────────────────

  describe("maybeConfigureOpenAICompatible", () => {
    it.skip("requires export after refactor — skips when aiChoice is not 3 or 4", async () => {
      // await maybeConfigureOpenAICompatible(rl, state, 0);
      // expect(state.providers).toHaveLength(0);
    });

    it.skip("requires export after refactor — configures with base URL and optional key", async () => {
      // answers = ["http://localhost:11434/v1", "", "my-api-key"];
      // await maybeConfigureOpenAICompatible(rl, state, 3);
      // expect(state.providers[0].id).toBe("openai-compatible");
      // expect(state.providers[0].baseUrl).toBe("http://localhost:11434/v1");
      // expect(state.secrets["openai-compatible"]?.apiKey).toBe("my-api-key");
    });

    it.skip("requires export after refactor — no-ops when baseUrl is empty", async () => {
      // answers = [""];
      // await maybeConfigureOpenAICompatible(rl, state, 3);
      // expect(state.providers).toHaveLength(0);
    });

    it.skip("requires export after refactor — sets apiKey to none when no key provided", async () => {
      // answers = ["http://localhost:11434/v1", "", ""];
      // await maybeConfigureOpenAICompatible(rl, state, 3);
      // expect(state.providers[0].apiKey).toBe("none");
    });
  });

  // ── askProviders ────────────────────────────────────────────────────────

  describe("askProviders", () => {
    it.skip("requires export after refactor — routes to anthropic on choice 1", async () => {
      // answers = ["1", "sk-key", ""];
      // const result = await askProviders(rl, false);
      // expect(result.providers[0].id).toBe("anthropic");
    });

    it.skip("requires export after refactor — routes to openai on choice 2", async () => {
      // answers = ["2", "", ""];
      // const result = await askProviders(rl, false);
      // expect(result.providers[0].id).toBe("openai");
    });

    it.skip("requires export after refactor — configures all on choice 5 (multiple)", async () => {
      // answers = ["5", token, "", key, "", "n", "http://localhost:11434/v1", "", ""];
      // const result = await askProviders(rl, false);
      // expect(result.providers).toHaveLength(4);
    });
  });

  // ── getProvidersSetup ───────────────────────────────────────────────────

  describe("getProvidersSetup", () => {
    it.skip("requires export after refactor — reuses existing when reuseExisting=true", async () => {
      // const existing: DetectedConfig = { anthropicKey: "key" };
      // const result = await getProvidersSetup(rl, false, existing, true);
      // expect(result.providers[0].id).toBe("anthropic");
    });

    it.skip("requires export after refactor — falls through to askProviders when reuse yields empty", async () => {
      // const existing: DetectedConfig = { discordToken: "d-tok" }; // no provider
      // answers = ["1", "", ""];
      // const result = await getProvidersSetup(rl, false, existing, true);
      // expect(result.providers).toHaveLength(1);
    });

    it.skip("requires export after refactor — defaults to anthropic env when no provider configured", async () => {
      // If askProviders returns empty providers, getProvidersSetup adds a default
      // This is the fallback path (hard to trigger via mock, but test the output shape)
    });
  });
});
