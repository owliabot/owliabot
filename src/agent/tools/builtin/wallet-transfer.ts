/**
 * Wallet Transfer Tool
 *
 * Execute ETH or ERC-20 token transfers via Clawlet.
 * Requires user confirmation for sign-level operations.
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import {
  getClawletClient,
  ClawletError,
  type TransferRequest,
  type ClawletClientConfig,
} from "../../../wallet/index.js";

export interface WalletTransferToolDeps {
  /** Clawlet client configuration */
  clawletConfig?: ClawletClientConfig;
  /** Default chain ID if not specified */
  defaultChainId?: number;
}

/**
 * Create the wallet_transfer tool
 */
export function createWalletTransferTool(deps: WalletTransferToolDeps = {}): ToolDefinition {
  const defaultChainId = deps.defaultChainId ?? 8453; // Base by default

  return {
    name: "wallet_transfer",
    description: `Transfer ETH or ERC-20 tokens to another address.

⚠️ This is a SIGN-level operation that requires user confirmation.
The transfer is subject to policy limits configured in Clawlet.

PARAMETERS:
- to: Recipient address (0x-prefixed, required)
- amount: Amount to transfer as decimal string (e.g. "0.1", required)
- token: Token to transfer (required)
  - "ETH" for native ETH
  - Token symbol (e.g. "USDC") if configured
  - Contract address (0x-prefixed)
- chain_id: Chain ID (optional, default: ${defaultChainId})

POLICY LIMITS:
- Daily transfer limits may apply
- Large transfers may require additional approval
- Certain tokens/recipients may be restricted

EXAMPLE:
{ "to": "0xRecipient...", "amount": "0.1", "token": "ETH", "chain_id": 8453 }`,
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient address (0x-prefixed)",
        },
        amount: {
          type: "string",
          description: "Amount to transfer (decimal string)",
        },
        token: {
          type: "string",
          description: 'Token to transfer ("ETH" or symbol/address)',
        },
        chain_id: {
          type: "number",
          description: `Chain ID (default: ${defaultChainId})`,
        },
      },
      required: ["to", "amount", "token"],
    },
    security: {
      level: "sign", // Requires signing — highest security level
      confirmRequired: true,
    },
    async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
      const p = params as WalletTransferParams;

      // Validate recipient address
      if (!p.to || !/^0x[a-fA-F0-9]{40}$/.test(p.to)) {
        return {
          success: false,
          error: `Invalid recipient address: ${p.to}. Must be 0x-prefixed 40-character hex.`,
        };
      }

      // Validate amount
      const amountNum = parseFloat(p.amount);
      if (!p.amount || isNaN(amountNum) || amountNum <= 0) {
        return {
          success: false,
          error: `Invalid amount: ${p.amount}. Must be a positive decimal number.`,
        };
      }

      // Validate token
      if (!p.token) {
        return {
          success: false,
          error: "Token is required. Use 'ETH' for native ETH or a token symbol/address.",
        };
      }

      const request: TransferRequest = {
        to: p.to,
        amount: p.amount,
        token_type: p.token.toUpperCase() === "ETH" ? "ETH" : p.token,
        chain_id: p.chain_id ?? defaultChainId,
      };

      // Request confirmation if the context supports it
      if (ctx.requestConfirmation) {
        const confirmed = await ctx.requestConfirmation({
          type: "transaction",
          title: "Confirm Transfer",
          description: `Transfer ${p.amount} ${p.token} to ${p.to}`,
          details: {
            "Recipient": p.to,
            "Amount": p.amount,
            "Token": p.token,
            "Chain ID": String(request.chain_id),
          },
          transaction: {
            to: p.to,
            value: p.token.toUpperCase() === "ETH" ? BigInt(Math.floor(amountNum * 1e18)) : 0n,
            data: "", // Will be populated by Clawlet for ERC-20
            chainId: request.chain_id,
          },
        });

        if (!confirmed) {
          return {
            success: false,
            error: "Transfer cancelled by user",
          };
        }
      }

      try {
        const client = getClawletClient(deps.clawletConfig);
        const result = await client.transfer(request);

        if (result.status === "denied") {
          return {
            success: false,
            error: `Transfer denied: ${result.reason ?? "Policy violation"}`,
          };
        }

        return {
          success: true,
          data: {
            status: result.status,
            tx_hash: result.tx_hash,
            audit_id: result.audit_id,
            summary: `Successfully transferred ${p.amount} ${p.token} to ${p.to}. TX: ${result.tx_hash}`,
          },
        };
      } catch (err) {
        if (err instanceof ClawletError) {
          // Provide helpful error messages
          switch (err.code) {
            case "UNAUTHORIZED":
              return {
                success: false,
                error: "Clawlet authentication failed. Check auth token configuration.",
              };
            case "CONNECTION_FAILED":
              return {
                success: false,
                error: "Could not connect to Clawlet. Is the daemon running?",
              };
            case "TIMEOUT":
              return {
                success: false,
                error: "Clawlet request timed out. The transaction may still be pending.",
              };
            default:
              return {
                success: false,
                error: `Clawlet error (${err.code}): ${err.message}`,
              };
          }
        }
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

interface WalletTransferParams {
  to: string;
  amount: string;
  token: string;
  chain_id?: number;
}
