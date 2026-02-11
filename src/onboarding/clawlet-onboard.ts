/**
 * Clawlet onboarding helper functions
 * 
 * Provides detection and token setup for the wallet onboarding flow.
 */

import { createInterface } from "node:readline";
import { ClawletClient, ClawletError } from "../wallet/clawlet-client.js";
import type { SecretsConfig } from "./secrets.js";
import { header, info, success, warn, ask, askYN } from "./shared.js";

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
            message: "Can't reach Clawlet. If it's installed, start it with: `clawlet serve`",
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
  info("Clawlet enables on-chain actions like balance checks and transfers.");
  info("If you don't need wallet tools right now, it's totally fine to skip this.");

  // Check if wallet is already configured
  if (secrets.clawlet?.token) {
    success("Looks like Clawlet is already connected.");
    const reconfigure = await askYN(rl, "Want to change the wallet settings?", false);
    if (!reconfigure) {
      info("Okay, I'll skip wallet setup for now.");
      return { enabled: false }; // Keep existing config in app.yaml
    }
  }

  console.log("");
  info("Checking if Clawlet is running...");

  const detection = await detectClawlet();

  if (!detection.detected) {
    if (detection.error) {
      warn(detection.error.message);
    }
    info("No worries — we'll skip wallet setup for now.");
    return { enabled: false };
  }

  // Daemon detected
  const versionInfo = detection.version ? ` (v${detection.version})` : "";
  success(`Clawlet is running${versionInfo}.`);

  const hasToken = await askYN(rl, "Do you already have a Clawlet token?", false);

  if (!hasToken) {
    // Show instructions for granting a token
    console.log("");
    info("To create one, run this on the machine where Clawlet is running:");
    console.log("  clawlet auth grant --agent owliabot --scope trade");
    console.log("");
    info("Then re-run: `owliabot onboard`");
    return { enabled: false };
  }

  const token = await ask(rl, "Paste your Clawlet token: ", true);

  if (!isValidClawletToken(token)) {
    warn("That doesn't look like a Clawlet token. It should start with 'clwt_'.");
    info("We'll skip wallet setup for now.");
    return { enabled: false };
  }

  // Save token to secrets
  secrets.clawlet = { token };
  success("Got it. Token saved.");

  // Get wallet address from daemon
  const client = new ClawletClient({ authToken: token });
  let defaultAddress: string | undefined;

  try {
    const addrResp = await client.address();
    defaultAddress = addrResp.address;
    success(`Wallet address: ${defaultAddress}`);
  } catch (err) {
    warn("I couldn't fetch the wallet address automatically (we can still continue).");
  }

  // Ask for default chain ID
  const chainIdAns = await ask(rl, "Default chain ID [8453 = Base]: ");
  const defaultChainId = chainIdAns ? parseInt(chainIdAns, 10) : 8453;

  // Ask for base URL (optional)
  const baseUrlAns = await ask(rl, "Clawlet URL [http://127.0.0.1:9100]: ");
  const baseUrl = baseUrlAns || "http://127.0.0.1:9100";

  success("Wallet tools enabled.");

  return {
    enabled: true,
    baseUrl,
    defaultChainId,
  };
}
