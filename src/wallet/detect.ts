/**
 * Clawlet daemon detection utilities.
 * Moved from onboarding/clawlet-onboard.ts — these are used by
 * the `wallet connect` CLI command independently of onboarding.
 */

import { ClawletClient, ClawletError } from "./clawlet-client.js";

/** Result of Clawlet daemon detection */
export interface ClawletDetectionResult {
  detected: boolean;
  version?: string;
  error?: {
    code: "NOT_INSTALLED" | "NOT_RUNNING" | "UNKNOWN";
    message: string;
  };
}

/**
 * Detect if Clawlet daemon is available
 */
export async function detectClawlet(): Promise<ClawletDetectionResult> {
  const client = new ClawletClient();

  try {
    const health = await client.health();
    return {
      detected: true,
      version: health.version,
    };
  } catch (err) {
    if (err instanceof ClawletError) {
      if (err.code === "CONNECTION_FAILED") {
        return {
          detected: false,
          error: {
            code: "NOT_RUNNING",
            message: "Clawlet not running (run: clawlet serve)",
          },
        };
      }
    }

    return {
      detected: false,
      error: {
        code: "UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Validate Clawlet token format
 */
export function isValidClawletToken(token: string): boolean {
  return token.startsWith("clwt_") && token.length > 10;
}
