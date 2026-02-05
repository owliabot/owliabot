// workspace/skills/transfer/index.js
// Demonstrates: sign tool (triggers TierPolicy evaluation)
//
// Security tiers based on USD value:
// - Tier 3 (< $50):    Auto-execute with notification
// - Tier 2 ($50-500):  Inline confirmation required
// - Tier 1 (> $500):   Companion App approval required

export const tools = {
  send: async ({ token, to, amount }, context) => {
    // Validate inputs
    if (!token || !to || !amount) {
      return {
        success: false,
        error: "Missing required parameters: token, to, amount",
      };
    }

    // Validate address format (basic check)
    if (!isValidAddress(to)) {
      return {
        success: false,
        error: `Invalid recipient address: ${to}`,
      };
    }

    // Parse amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return {
        success: false,
        error: `Invalid amount: ${amount}`,
      };
    }

    try {
      // Call the signer - this triggers TierPolicy evaluation
      // The signer will:
      // 1. Look up token price to calculate USD value
      // 2. Determine security tier based on value
      // 3. Request appropriate confirmation (or auto-execute for Tier 3)
      // 4. Build, sign, and broadcast the transaction
      const result = await context.callSigner("transfer", {
        token: token.toUpperCase(),
        to,
        amount: parsedAmount.toString(),
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Transfer failed",
        };
      }

      return {
        success: true,
        data: {
          action: "transferred",
          token: token.toUpperCase(),
          to,
          amount: parsedAmount.toString(),
          txHash: result.data?.txHash,
          explorerUrl: result.data?.explorerUrl || null,
          tier: result.effectiveTier || result.data?.tier,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Transfer failed: ${err.message}`,
      };
    }
  },

  estimate: async ({ token, to, amount }, context) => {
    // Validate inputs
    if (!token || !to || !amount) {
      return {
        success: false,
        error: "Missing required parameters: token, to, amount",
      };
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return {
        success: false,
        error: `Invalid amount: ${amount}`,
      };
    }

    try {
      // Read-only estimation - no signer needed
      const estimate = await context.callSigner("estimate", {
        token: token.toUpperCase(),
        to,
        amount: parsedAmount.toString(),
      });

      if (!estimate.success) {
        return {
          success: false,
          error: estimate.error || "Estimation failed",
        };
      }

      // Determine which tier this would trigger
      const usdValue = estimate.data?.usdValue || 0;
      let tier, tierDescription;

      if (usdValue < 50) {
        tier = 3;
        tierDescription = "Auto-execute (low value)";
      } else if (usdValue <= 500) {
        tier = 2;
        tierDescription = "Inline confirmation required";
      } else {
        tier = 1;
        tierDescription = "Companion App approval required";
      }

      return {
        success: true,
        data: {
          token: token.toUpperCase(),
          to,
          amount: parsedAmount.toString(),
          estimatedGas: estimate.data?.gas,
          estimatedFee: estimate.data?.fee,
          feeCurrency: estimate.data?.feeCurrency,
          usdValue: usdValue.toFixed(2),
          tier,
          tierDescription,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Estimation failed: ${err.message}`,
      };
    }
  },
};

/**
 * Basic address validation
 * Supports Ethereum (0x...) and Solana (base58) formats
 */
function isValidAddress(address) {
  if (!address || typeof address !== "string") {
    return false;
  }

  // Ethereum address (0x + 40 hex chars)
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return true;
  }

  // Solana address (32-44 base58 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return true;
  }

  return false;
}
