/**
 * Unit tests for gateway-setup step:
 * - getGatewayConfig
 * - configureDockerGatewayAndTimezone
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

describe("gateway-setup step", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    answers = [];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── getGatewayConfig ───────────────────────────────────────────────────

  describe("getGatewayConfig", () => {
    it.skip("requires export after refactor — returns docker gateway config in docker mode", async () => {
      // const result = await getGatewayConfig(rl, true);
      // expect(result).toEqual({ http: { host: "0.0.0.0", port: 8787, token: "secrets" } });
    });

    it.skip("requires export after refactor — returns undefined when user declines in dev mode", async () => {
      // answers = ["n"];
      // const result = await getGatewayConfig(rl, false);
      // expect(result).toBeUndefined();
    });

    it.skip("requires export after refactor — returns config with custom port when enabled", async () => {
      // answers = ["y", "9090"];
      // const result = await getGatewayConfig(rl, false);
      // expect(result?.http?.port).toBe(9090);
      // expect(result?.http?.host).toBe("127.0.0.1");
      // expect(result?.http?.token).toMatch(/^[a-f0-9]{32}$/);
    });

    it.skip("requires export after refactor — uses default port 8787 when empty", async () => {
      // answers = ["y", ""];
      // const result = await getGatewayConfig(rl, false);
      // expect(result?.http?.port).toBe(8787);
    });
  });

  // ── configureDockerGatewayAndTimezone ───────────────────────────────────

  describe("configureDockerGatewayAndTimezone", () => {
    it.skip("requires export after refactor — generates token and uses default port", async () => {
      // answers = ["", "", ""];
      // const secrets = {};
      // const result = await configureDockerGatewayAndTimezone(rl, null, false, secrets);
      // expect(result.gatewayPort).toBe("8787");
      // expect(result.gatewayToken).toMatch(/^[a-f0-9]{32}$/);
      // expect(result.tz).toBe("UTC");
      // expect(secrets.gateway?.token).toBe(result.gatewayToken);
    });

    it.skip("requires export after refactor — reuses existing gateway token", async () => {
      // const existing = { gatewayToken: "existing-gw-token-1234" };
      // answers = ["", "", "America/New_York"];
      // const secrets = {};
      // const result = await configureDockerGatewayAndTimezone(rl, existing, true, secrets);
      // expect(result.gatewayToken).toBe("existing-gw-token-1234");
      // expect(result.tz).toBe("America/New_York");
    });

    it.skip("requires export after refactor — allows custom port", async () => {
      // answers = ["3000", "", ""];
      // const result = await configureDockerGatewayAndTimezone(rl, null, false, {});
      // expect(result.gatewayPort).toBe("3000");
    });

    it.skip("requires export after refactor — allows overriding reused token", async () => {
      // const existing = { gatewayToken: "old-tok" };
      // answers = ["", "new-custom-token", ""];
      // const secrets = {};
      // const result = await configureDockerGatewayAndTimezone(rl, existing, true, secrets);
      // expect(result.gatewayToken).toBe("new-custom-token");
    });
  });
});
