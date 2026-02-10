/**
 * Clawlet onboarding helper functions
 * 
 * Provides detection and token setup for the wallet onboarding flow.
 */

import { createInterface } from "node:readline";
import { ClawletClient, ClawletError } from "../wallet/clawlet-client.js";
import type { SecretsConfig } from "./secrets.js";
import { ask, askYN, header, info, success, warn } from "./shared.js";

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
            message: "Clawlet isn't running yet (start it with: clawlet serve)",
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

/** Wallet configuration result from onboarding */
export interface WalletConfigResult {
  enabled: boolean;
  baseUrl?: string;
  defaultChainId?: number;
  defaultAddress?: string;
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
  header("Wallet (optional)");

  // Check if wallet is already configured
  if (secrets.clawlet?.token) {
    success("Clawlet token already set");
    const reconfigure = await askYN(rl, "Do you want to change your wallet settings?", false);
    if (!reconfigure) {
      info("Keeping your existing wallet settings");
      return { enabled: false }; // Keep existing config in app.yaml
    }
  }

  info("Clawlet enables on-chain actions (balance checks, transfers).");
  info("Checking whether Clawlet is running...");

  const detection = await detectClawlet();

  if (!detection.detected) {
    if (detection.error) {
      warn(detection.error.message);
    }
    // Skip silently - user can configure later
    return { enabled: false };
  }

  // Daemon detected
  const versionInfo = detection.version ? ` (v${detection.version})` : "";
  success(`Clawlet is running${versionInfo}`);

  const hasToken = await askYN(rl, "Do you already have a Clawlet token?", false);

  if (!hasToken) {
    // Show instructions for granting a token
    info("No problem. On the Clawlet host, run:");
    info("  clawlet auth grant --agent owliabot --scope trade");
    info("Then come back and run: owliabot onboard");
    return { enabled: false };
  }

  const token = await ask(rl, "Paste your Clawlet token: ", true);

  if (!isValidClawletToken(token)) {
    warn("That token doesn't look right (it should start with 'clwt_'). Skipping wallet setup for now.");
    return { enabled: false };
  }

  // Save token to secrets
  secrets.clawlet = { token };
  success("Clawlet token saved");

  // Get wallet address from daemon
  const client = new ClawletClient({ authToken: token });
  let defaultAddress: string | undefined;

  try {
    const addrResp = await client.address();
    defaultAddress = addrResp.address;
    success(`Wallet address: ${defaultAddress}`);
  } catch (err) {
    warn("I couldn't fetch your wallet address automatically. You can set it later.");
  }

  // Ask for default chain ID
  const chainIdAns = await ask(rl, "Default chain ID [8453 for Base]: ");
  const defaultChainId = chainIdAns ? parseInt(chainIdAns, 10) : 8453;

  // Ask for base URL (optional)
  const baseUrlAns = await ask(rl, "Clawlet base URL [http://127.0.0.1:9100]: ");
  const baseUrl = baseUrlAns || "http://127.0.0.1:9100";

  success("Wallet tools enabled");

  return {
    enabled: true,
    baseUrl,
    defaultChainId,
    defaultAddress,
  };
}
