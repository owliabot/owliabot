/**
 * Clawlet onboarding helper functions
 * 
 * Provides detection and token setup for the wallet onboarding flow.
 */

import { createInterface } from "node:readline";
import { ClawletClient, ClawletError } from "../wallet/clawlet-client.js";
import { createLogger } from "../utils/logger.js";
import type { SecretsConfig } from "./secrets.js";

const log = createLogger("clawlet-onboard");

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
    if (err instanceof ClawletError && err.code === "CONNECTION_FAILED") {
      // Check the underlying error message to distinguish ENOENT vs ECONNREFUSED
      if (err.message.includes("Socket not found")) {
        return {
          detected: false,
          error: {
            code: "NOT_INSTALLED",
            message: "Clawlet not installed (run: cargo install clawlet-cli)",
          },
        };
      } else if (err.message.includes("Connection refused")) {
        return {
          detected: false,
          error: {
            code: "NOT_RUNNING",
            message: "Clawlet not running (run: clawlet serve)",
          },
        };
      }
    }
    
    // Unknown error
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

/** Helper to prompt user */
function ask(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
}

/**
 * Run Clawlet wallet setup in onboarding flow
 * 
 * @param rl - readline interface from main onboarding
 * @param secrets - secrets config to populate
 * @returns true if token was configured, false otherwise
 */
export async function runClawletOnboarding(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig
): Promise<boolean> {
  log.info("\n== Wallet Setup (optional) ==");
  log.info("Clawlet enables on-chain operations (balance queries, transfers).");
  log.info("\nChecking for clawlet daemon...");

  const detection = await detectClawlet();

  if (!detection.detected) {
    if (detection.error) {
      log.info(`✗ ${detection.error.message}`);
    }
    // Skip silently - user can configure later
    return false;
  }

  // Daemon detected
  const versionInfo = detection.version ? ` (v${detection.version})` : "";
  log.info(`✓ Clawlet daemon detected${versionInfo}`);

  const hasTokenAns = await ask(rl, "\nDo you have a Clawlet token? (y/n): ");
  const hasToken = hasTokenAns.toLowerCase().startsWith("y");

  if (hasToken) {
    const token = await ask(rl, "Paste Clawlet token: ");
    
    if (!isValidClawletToken(token)) {
      log.warn("Invalid token format (should start with 'clwt_'). Skipping wallet setup.");
      return false;
    }
    
    // Save token to secrets
    secrets.clawlet = { token };
    log.info("✓ Clawlet token saved");
    return true;
  } else {
    // Show instructions for granting a token
    log.info("\nTo grant a token, run on the clawlet host:");
    log.info("  clawlet auth grant --agent owliabot --scope trade");
    log.info("\nThen re-run: owliabot onboard");
    return false;
  }
}
