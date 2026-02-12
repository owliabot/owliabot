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
    if (err instanceof ClawletError) {
      if (err.code === "CONNECTION_FAILED") {
        // Connection refused means daemon not running
        return {
          detected: false,
          error: {
            code: "NOT_RUNNING",
            message: "Clawlet not running (run: clawlet serve)",
          },
        };
      }
    }
    
    // Unknown error (includes fetch failures when not installed)
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

/** Wallet configuration result from onboarding */
export interface WalletConfigResult {
  enabled: boolean;
  baseUrl?: string;
  defaultChainId?: number;
}

/**
 * Run Clawlet wallet setup in onboarding flow
 *
 * @param rl - readline interface from main onboarding
 * @param secrets - secrets config to populate
 * @returns wallet configuration object (enabled: false if skipped)
 */
export async function runClawletOnboarding(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig
): Promise<WalletConfigResult> {
  log.info("\n== Wallet Setup (optional) ==");

  // Check if wallet is already configured
  if (secrets.clawlet?.token) {
    log.info("✓ Clawlet token already configured");
    const skipAns = await ask(rl, "Reconfigure wallet settings? (y/n): ");
    if (!skipAns.toLowerCase().startsWith("y")) {
      log.info("Keeping existing wallet configuration");
      return { enabled: false }; // Keep existing config in app.yaml
    }
  }

  log.info("Clawlet enables on-chain operations (balance queries, transfers).");
  log.info("\nChecking for clawlet daemon...");

  const detection = await detectClawlet();

  if (!detection.detected) {
    if (detection.error) {
      log.info(`✗ ${detection.error.message}`);
    }
    // Skip silently - user can configure later
    return { enabled: false };
  }

  // Daemon detected
  const versionInfo = detection.version ? ` (v${detection.version})` : "";
  log.info(`✓ Clawlet daemon detected${versionInfo}`);

  const hasTokenAns = await ask(rl, "\nDo you have a Clawlet token? (y/n): ");
  const hasToken = hasTokenAns.toLowerCase().startsWith("y");

  if (!hasToken) {
    // Show instructions for granting a token
    log.info("\nTo grant a token, run on the clawlet host:");
    log.info("  clawlet auth grant --scope trade --label owliabot");
    log.info("\nThen re-run: owliabot onboard");
    return { enabled: false };
  }

  const token = await ask(rl, "Paste Clawlet token: ");

  if (!isValidClawletToken(token)) {
    log.warn("Invalid token format (should start with 'clwt_'). Skipping wallet setup.");
    return { enabled: false };
  }

  // Save token to secrets
  secrets.clawlet = { token };
  log.info("✓ Clawlet token saved");

  // Ask for default chain ID
  const chainIdAns = await ask(rl, "Default chain ID [8453 for Base]: ");
  const defaultChainId = chainIdAns ? parseInt(chainIdAns, 10) : 8453;

  // Ask for base URL (optional)
  const baseUrlAns = await ask(rl, "Clawlet base URL [http://127.0.0.1:9100]: ");
  const baseUrl = baseUrlAns || "http://127.0.0.1:9100";

  log.info("✓ Wallet tools enabled");

  return {
    enabled: true,
    baseUrl,
    defaultChainId,
  };
}
