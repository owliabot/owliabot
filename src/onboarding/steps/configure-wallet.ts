/**
 * Step module: wallet configuration.
 */

import { createInterface } from "node:readline";
import type { AppConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { runClawletOnboarding } from "../clawlet-onboard.js";

export async function configureWallet(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
  config: AppConfig,
): Promise<void> {
  const walletConfig = await runClawletOnboarding(rl, secrets);
  if (!walletConfig.enabled) return;

  config.wallet = {
    clawlet: {
      enabled: true,
      baseUrl: walletConfig.baseUrl,
      requestTimeout: 30000,
      defaultChainId: walletConfig.defaultChainId,
      ...(walletConfig.defaultAddress ? { defaultAddress: walletConfig.defaultAddress } : {}),
    },
  };
}
