/**
 * Unit tests for configureWallet step function.
 *
 * configureWallet handles the clawlet wallet setup during onboarding,
 * delegating to runClawletOnboarding and integrating the result into config.
 *
 * NOT exported yet — tests are skipped until the refactor exports this function.
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
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock("../../auth/oauth.js", () => ({
  startOAuthFlow: vi.fn().mockResolvedValue({}),
}));

vi.mock("../clawlet-onboard.js", () => ({
  runClawletOnboarding: vi.fn().mockResolvedValue({ enabled: false }),
}));

describe("configureWallet step", () => {
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

  it.skip("requires export after refactor — skips wallet when clawlet returns enabled=false", async () => {
    // const { runClawletOnboarding } = await import("../clawlet-onboard.js");
    // vi.mocked(runClawletOnboarding).mockResolvedValue({ enabled: false });
    // const config: any = {};
    // await configureWallet(rl, config);
    // expect(config.wallet).toBeUndefined();
  });

  it.skip("requires export after refactor — configures wallet when clawlet returns enabled=true", async () => {
    // const { runClawletOnboarding } = await import("../clawlet-onboard.js");
    // vi.mocked(runClawletOnboarding).mockResolvedValue({ enabled: true, address: "0xABC" });
    // const config: any = {};
    // await configureWallet(rl, config);
    // expect(config.wallet).toBeDefined();
    // expect(config.wallet.address).toBe("0xABC");
  });

  it.skip("requires export after refactor — handles clawlet onboarding error gracefully", async () => {
    // const { runClawletOnboarding } = await import("../clawlet-onboard.js");
    // vi.mocked(runClawletOnboarding).mockRejectedValue(new Error("daemon not running"));
    // const config: any = {};
    // await configureWallet(rl, config);
    // expect(config.wallet).toBeUndefined();
    // // Should log warning but not throw
  });
});
