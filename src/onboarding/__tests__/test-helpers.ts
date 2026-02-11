/**
 * Shared test helpers for onboarding step tests.
 *
 * Centralises type stubs, mock factories, and utilities used across
 * multiple test files so they don't need to be duplicated.
 */

// ---------------------------------------------------------------------------
// Type stubs — mirrors internal types from onboard.ts until refactor exports them
// ---------------------------------------------------------------------------

export interface DetectedConfig {
  anthropicKey?: string;
  anthropicToken?: string;
  openaiKey?: string;
  openaiCompatKey?: string;
  discordToken?: string;
  telegramToken?: string;
  gatewayToken?: string;
  hasOAuthAnthro?: boolean;
  hasOAuthCodex?: boolean;
}

export interface ProviderResult {
  providers: any[];
  secrets: Record<string, any>;
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

// ---------------------------------------------------------------------------
// Readline mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a readline mock controlled by the returned `answers` array.
 * Push answer strings before the code-under-test calls `rl.question()`.
 *
 * Usage in vi.mock:
 *   const { answers, promptLog, mockFactory } = createReadlineMock();
 *   vi.mock("node:readline", () => ({ createInterface: mockFactory }));
 */
export function createReadlineMock() {
  const answers: string[] = [];
  const promptLog: string[] = [];

  const mockFactory = () => ({
    question: (q: string, cb: (ans: string) => void) => {
      promptLog.push(q);
      const next = answers.shift();
      if (next === undefined) throw new Error(`Ran out of answers at: "${q}"`);
      cb(next);
    },
    close: () => {},
    pause: () => {},
    resume: () => {},
  });

  return { answers, promptLog, mockFactory };
}
