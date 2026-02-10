/**
 * Unit tests for gateway-setup step:
 * - getGatewayConfig
 * - configureDockerGatewayAndTimezone
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";

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

// Override ask to never use secret mode (stdin.on("data") hangs in tests)
vi.mock("../shared.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../shared.js")>();
  return {
    ...original,
    ask: (rl: any, q: string, _secret?: boolean) => {
      // Always use rl.question, ignore secret flag
      return new Promise<string>((resolve) => {
        rl.question(q, (ans: string) => resolve(ans.trim()));
      });
    },
  };
});

import { getGatewayConfig, configureDockerGatewayAndTimezone } from "../steps/gateway-setup.js";

describe("gateway-setup step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let rl: ReturnType<typeof createInterface>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
    rl = createInterface({ input: process.stdin, output: process.stdout });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ── getGatewayConfig ───────────────────────────────────────────────────

  describe("getGatewayConfig", () => {
    it("returns docker gateway config in docker mode", async () => {
      const result = await getGatewayConfig(rl, true);
      expect(result).toEqual({ http: { host: "0.0.0.0", port: 8787, token: "secrets" } });
    });

    it("returns undefined when user declines in dev mode", async () => {
      answers = ["n"];
      const result = await getGatewayConfig(rl, false);
      expect(result).toBeUndefined();
    });

    it("returns config with custom port when enabled", async () => {
      answers = ["y", "9090"];
      const result = await getGatewayConfig(rl, false);
      expect(result?.http?.port).toBe(9090);
      expect(result?.http?.host).toBe("127.0.0.1");
      expect(result?.http?.token).toMatch(/^[a-f0-9]{32}$/);
    });

    it("uses default port 8787 when empty", async () => {
      answers = ["y", ""];
      const result = await getGatewayConfig(rl, false);
      expect(result?.http?.port).toBe(8787);
    });
  });

  // ── configureDockerGatewayAndTimezone ───────────────────────────────────

  describe("configureDockerGatewayAndTimezone", () => {
    it("generates token and uses default port", async () => {
      answers = ["", "", ""];
      const secrets: any = {};
      const result = await configureDockerGatewayAndTimezone(rl, null, false, secrets);
      expect(result.gatewayPort).toBe("8787");
      expect(result.gatewayToken).toMatch(/^[a-f0-9]{32}$/);
      expect(result.tz).toBe("UTC");
      expect(secrets.gateway?.token).toBe(result.gatewayToken);
    });

    it("reuses existing gateway token", async () => {
      const existing: any = { gatewayToken: "existing-gw-token-12345678" };
      answers = ["", "", "America/New_York"];
      const secrets: any = {};
      const result = await configureDockerGatewayAndTimezone(rl, existing, true, secrets);
      expect(result.gatewayToken).toBe("existing-gw-token-12345678");
      expect(result.tz).toBe("America/New_York");
    });

    it("allows custom port", async () => {
      answers = ["3000", "", ""];
      const result = await configureDockerGatewayAndTimezone(rl, null, false, {} as any);
      expect(result.gatewayPort).toBe("3000");
    });

    it("allows overriding reused token", async () => {
      const existing: any = { gatewayToken: "old-tok-1234567890123456" };
      answers = ["", "new-custom-token", ""];
      const secrets: any = {};
      const result = await configureDockerGatewayAndTimezone(rl, existing, true, secrets);
      expect(result.gatewayToken).toBe("new-custom-token");
    });
  });
});
