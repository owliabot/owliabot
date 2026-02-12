/**
 * Wallet Balance Tool
 *
 * Query ETH and ERC-20 token balances via Clawlet.
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import {
  getClawletClient,
  ClawletError,
  type BalanceQuery,
  type ClawletClientConfig,
  type ChainInfo,
} from "../../../wallet/index.js";
import { formatChainList } from "./wallet.js";

export interface WalletBalanceToolDeps {
  /** Clawlet client configuration */
  clawletConfig?: ClawletClientConfig;
  /** Default chain ID if not specified */
  defaultChainId?: number;
  /** Supported chains fetched from Clawlet daemon */
  supportedChains?: ChainInfo[];
}

/**
 * Create the wallet_balance tool
 */
export function createWalletBalanceTool(deps: WalletBalanceToolDeps = {}): ToolDefinition {
  const defaultChainId = deps.defaultChainId ?? 8453; // Base by default

  return {
    name: "wallet_balance",
    description: `Query ETH and ERC-20 token balances for a wallet address.

Returns the native ETH balance and any tracked token balances.

PARAMETERS:
- address: Wallet address to query (0x-prefixed, required)
- chain_id: Chain ID (optional, default: ${defaultChainId})

SUPPORTED CHAINS:
${formatChainList(deps.supportedChains)}

EXAMPLE:
{ "address": "0x1234...5678", "chain_id": 8453 }`,
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address (0x-prefixed)",
        },
        chain_id: {
          type: "number",
          description: `Chain ID (default: ${defaultChainId})`,
        },
      },
      required: ["address"],
    },
    security: {
      level: "read", // Read-only operation, no confirmation needed
    },
    async execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
      const p = params as WalletBalanceParams;

      // Validate address
      if (!p.address || !/^0x[a-fA-F0-9]{40}$/.test(p.address)) {
        return {
          success: false,
          error: `Invalid address format: ${p.address}. Must be 0x-prefixed 40-character hex.`,
        };
      }

      const query: BalanceQuery = {
        address: p.address,
        chain_id: p.chain_id ?? defaultChainId,
      };

      try {
        const client = getClawletClient(deps.clawletConfig);
        const result = await client.balance(query);

        // Format response for LLM
        const tokenSummary = result.tokens.length > 0
          ? result.tokens.map(t => `${t.symbol}: ${t.balance}`).join(", ")
          : "No tracked tokens";

        return {
          success: true,
          data: {
            address: p.address,
            chain_id: query.chain_id,
            eth: result.eth,
            tokens: result.tokens,
            summary: `ETH: ${result.eth}, Tokens: ${tokenSummary}`,
          },
        };
      } catch (err) {
        if (err instanceof ClawletError) {
          return {
            success: false,
            error: `Clawlet error (${err.code}): ${err.message}`,
          };
        }
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

interface WalletBalanceParams {
  address: string;
  chain_id?: number;
}
