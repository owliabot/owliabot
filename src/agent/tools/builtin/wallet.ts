/**
 * Wallet Tools
 *
 * Agent tools for wallet balance queries and token transfers via Clawlet.
 *
 * - wallet_balance: Query ETH + token balances (read scope, no confirmation)
 * - wallet_transfer: Execute transfers (trade scope, requires confirmation via WriteGate)
 *
 * @see src/wallet/clawlet-client.ts
 * @see src/security/write-gate.ts
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../interface.js";
import {
  getClawletClient,
  ClawletError,
  type BalanceQuery,
  type TransferRequest,
  type SendRawRequest,
  type ClawletClientConfig,
  type ChainInfo,
} from "../../../wallet/index.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("wallet-tools");
const STRICT_DECIMAL_REGEX = /^[0-9]+(\.[0-9]+)?$/;
const WEI_PER_ETH = 1_000_000_000_000_000_000n;

// ============================================================================
// Shared Config
// ============================================================================

export interface WalletToolsConfig {
  /** Clawlet client configuration */
  clawletConfig?: ClawletClientConfig;
  /** Default chain ID if not specified (default: 8453 = Base) */
  defaultChainId?: number;
  /** Whether wallet tools are enabled (check config.wallet.clawlet.enabled) */
  enabled?: boolean;
  /** Supported chains fetched from Clawlet daemon */
  supportedChains?: ChainInfo[];
}

/**
 * Format supported chains for tool descriptions.
 * Falls back to a generic message when chains are not available.
 */
export function formatChainList(chains?: ChainInfo[]): string {
  if (!chains?.length) return "(query wallet service for current supported chains)";
  return chains.map(c => `- ${c.chain_id}: ${c.name}${c.testnet ? " (testnet)" : ""}`).join("\n");
}

// ============================================================================
// Parameter Schemas (Zod)
// ============================================================================

const WalletBalanceParamsSchema = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be 0x-prefixed 40-character hex")
    .optional()
    .describe("Wallet address (optional, defaults to configured wallet)"),
  chain_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Chain ID (optional, defaults from config)"),
});

type WalletBalanceParams = z.infer<typeof WalletBalanceParamsSchema>;

const WalletTransferParamsSchema = z.object({
  to: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be 0x-prefixed 40-character hex")
    .describe("Recipient address (required)"),
  amount: z
    .string()
    .regex(
      STRICT_DECIMAL_REGEX,
      "Must be a strict decimal string (digits with optional decimal part)",
    )
    .describe("Amount to transfer (decimal string, required)"),
  token: z
    .string()
    .default("ETH")
    .describe('Token to transfer ("ETH" or symbol/address, default: ETH)'),
  chain_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Chain ID (optional, defaults from config)"),
});

type WalletTransferParams = z.infer<typeof WalletTransferParamsSchema>;

function parseEthAmountToWei(amount: string): bigint | null {
  if (!STRICT_DECIMAL_REGEX.test(amount)) {
    return null;
  }

  const [wholePart, fractionalPart = ""] = amount.split(".");
  if (fractionalPart.length > 18) {
    return null;
  }

  const wholeWei = BigInt(wholePart) * WEI_PER_ETH;
  const fractionalWei = BigInt(fractionalPart.padEnd(18, "0") || "0");
  const totalWei = wholeWei + fractionalWei;

  return totalWei > 0n ? totalWei : null;
}

// ============================================================================
// wallet_balance Tool
// ============================================================================

/**
 * Create the wallet_balance tool
 *
 * Scope: read (no confirmation needed)
 * Returns: ETH balance + token balances
 */
export function createWalletBalanceTool(config: WalletToolsConfig = {}): ToolDefinition {
  const defaultChainId = config.defaultChainId ?? 8453;

  return {
    name: "wallet_balance",
    description: `Query ETH and ERC-20 token balances for a wallet address.

Returns the native ETH balance and any tracked token balances.

PARAMETERS:
- address: Wallet address to query (0x-prefixed). If omitted, fetches address from wallet service.
- chain_id: Chain ID (default: ${defaultChainId})

SUPPORTED CHAINS:
${formatChainList(config.supportedChains)}

EXAMPLE:
{ "chain_id": 8453 }  // Uses wallet's own address
{ "address": "0x1234...5678", "chain_id": 1 }  // Specific address`,
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address (0x-prefixed, optional — fetched from wallet service if omitted)",
        },
        chain_id: {
          type: "number",
          description: `Chain ID (default: ${defaultChainId})`,
        },
      },
      required: [],
    },
    security: {
      level: "read", // Read-only operation, no confirmation needed
    },
    async execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
      // Parse and validate params
      const parseResult = WalletBalanceParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Invalid parameters: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
        };
      }

      const p = parseResult.data;
      let address = p.address;

      // If no address provided, fetch from wallet service
      if (!address) {
        try {
          const client = getClawletClient(config.clawletConfig);
          const addrResp = await client.address();
          address = addrResp.address;
        } catch (err) {
          return handleClawletError(err, "address lookup");
        }
      }

      const query: BalanceQuery = {
        address,
        chain_id: p.chain_id ?? defaultChainId,
      };

      try {
        const client = getClawletClient(config.clawletConfig);
        const result = await client.balance(query);

        // Format response for LLM
        const tokenSummary =
          result.tokens.length > 0
            ? result.tokens.map((t) => `${t.symbol}: ${t.balance}`).join(", ")
            : "No tracked tokens";

        return {
          success: true,
          data: {
            address: query.address,
            chain_id: query.chain_id,
            eth: result.eth,
            tokens: result.tokens,
            summary: `ETH: ${result.eth}, Tokens: ${tokenSummary}`,
          },
        };
      } catch (err) {
        return handleClawletError(err, "balance query");
      }
    },
  };
}

// ============================================================================
// wallet_transfer Tool
// ============================================================================

/**
 * Create the wallet_transfer tool
 *
 * Scope: trade (requires confirmation via WriteGate)
 * Shows confirmation: "Transfer X ETH to 0x... on chain Y. Confirm? [y/n]"
 * Returns: tx_hash on success, denial reason on policy reject
 */
export function createWalletTransferTool(config: WalletToolsConfig = {}): ToolDefinition {
  const defaultChainId = config.defaultChainId ?? 8453;

  return {
    name: "wallet_transfer",
    description: `Transfer ETH or ERC-20 tokens to another address.

⚠️ This is a TRADE-level operation that requires user confirmation via WriteGate.
The transfer is subject to policy limits configured in Clawlet.

PARAMETERS:
- to: Recipient address (0x-prefixed, required)
- amount: Amount to transfer as decimal string (e.g. "0.1", required)
- token: Token to transfer (default: "ETH")
  - "ETH" for native ETH
  - Token symbol (e.g. "USDC") if configured
  - Contract address (0x-prefixed)
- chain_id: Chain ID (default: ${defaultChainId})

SUPPORTED CHAINS:
${formatChainList(config.supportedChains)}

POLICY LIMITS:
- Daily transfer limits may apply
- Large transfers may require additional approval
- Certain tokens/recipients may be restricted

EXAMPLE:
{ "to": "0xRecipient...", "amount": "0.1" }  // 0.1 ETH
{ "to": "0xRecipient...", "amount": "100", "token": "USDC", "chain_id": 8453 }`,
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
          description: 'Token to transfer ("ETH" or symbol/address, default: ETH)',
        },
        chain_id: {
          type: "number",
          description: `Chain ID (default: ${defaultChainId})`,
        },
      },
      required: ["to", "amount"],
    },
    security: {
      level: "sign", // Trade/sign level — requires confirmation
      confirmRequired: true,
    },
    async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
      // Parse and validate params
      const parseResult = WalletTransferParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Invalid parameters: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
        };
      }

      const p = parseResult.data;
      const chainId = p.chain_id ?? defaultChainId;
      const tokenType = p.token.toUpperCase() === "ETH" ? "ETH" : p.token;
      const parsedAmountWei = parseEthAmountToWei(p.amount);

      if (!parsedAmountWei) {
        return {
          success: false,
          error:
            "Invalid parameters: amount must be a positive decimal number with up to 18 fractional digits",
        };
      }

      const request: TransferRequest = {
        to: p.to,
        amount: p.amount,
        token_type: tokenType,
        chain_id: chainId,
      };

      // ─────────────────────────────────────────────────────────────────────
      // Confirmation via WriteGate pattern
      // The executor should integrate with WriteGate, but we also support
      // the ToolContext.requestConfirmation callback for flexibility.
      // ─────────────────────────────────────────────────────────────────────
      if (!ctx.requestConfirmation) {
        return {
          success: false,
          error: "Transfer rejected: confirmation callback is required for signing operations",
        };
      }

      const confirmed = await ctx.requestConfirmation({
        type: "transaction",
        title: "Confirm Transfer",
        description: `Transfer ${p.amount} ${p.token} to ${p.to} on chain ${chainId}. Confirm? [y/n]`,
        details: {
          Recipient: p.to,
          Amount: p.amount,
          Token: p.token,
          "Chain ID": String(chainId),
        },
        transaction: {
          to: p.to,
          value: tokenType === "ETH" ? parsedAmountWei : 0n,
          data: "", // Populated by Clawlet for ERC-20
          chainId,
        },
      });

      if (!confirmed) {
        log.info(`Transfer denied by user: ${p.amount} ${p.token} to ${p.to}`);
        return {
          success: false,
          error: "Transfer cancelled by user",
        };
      }

      // ─────────────────────────────────────────────────────────────────────
      // Execute transfer via Clawlet
      // ─────────────────────────────────────────────────────────────────────
      try {
        const client = getClawletClient(config.clawletConfig);
        const result = await client.transfer(request);

        if (result.status === "denied") {
          log.warn(`Transfer denied by policy: ${result.reason}`);
          return {
            success: false,
            error: `Transfer denied: ${result.reason ?? "Policy violation"}`,
          };
        }

        log.info(`Transfer successful: ${result.tx_hash}`);
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
        return handleClawletError(err, "transfer");
      }
    },
  };
}

// ============================================================================
// wallet_send_tx Tool
// ============================================================================

const WalletSendTxParamsSchema = z.object({
  to: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be 0x-prefixed 40-character hex")
    .describe("Recipient address (required)"),
  value: z
    .string()
    .regex(/^(0x[a-fA-F0-9]+|\d+)$/, "Must be a decimal string or 0x-prefixed hex")
    .optional()
    .describe("Value in wei (hex or decimal string)"),
  data: z
    .string()
    .regex(/^0x([a-fA-F0-9]{2})*$/, "Must be 0x-prefixed even-length hex string")
    .optional()
    .describe("Calldata (0x-prefixed hex)"),
  chain_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Chain ID (optional, defaults from config)"),
  gas_limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Gas limit (optional)"),
});

type WalletSendTxParams = z.infer<typeof WalletSendTxParamsSchema>;

/**
 * Create the wallet_send_tx tool
 *
 * Scope: trade (requires confirmation via WriteGate)
 * Sends a raw transaction with arbitrary calldata via Clawlet.
 */
export function createWalletSendTxTool(config: WalletToolsConfig = {}): ToolDefinition {
  const defaultChainId = config.defaultChainId ?? 8453;

  return {
    name: "wallet_send_tx",
    description: `Send a raw transaction via the wallet service.

⚠️ This is a SIGN-level operation that requires user confirmation.

Unlike wallet_transfer (high-level transfer), this sends raw transaction data
with arbitrary calldata — useful for contract interactions, approvals, swaps, etc.

PARAMETERS:
- to: Destination address (0x-prefixed, required)
- value: Value in wei as string (optional, default "0")
- data: Calldata hex string (optional)
- chain_id: Chain ID (default: ${defaultChainId})
- gas_limit: Gas limit (optional, estimated if omitted)

SUPPORTED CHAINS:
${formatChainList(config.supportedChains)}

EXAMPLE:
{ "to": "0xContract...", "data": "0xa9059cbb...", "chain_id": 8453 }
{ "to": "0xRecipient...", "value": "1000000000000000000" }`,
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Destination address (0x-prefixed)",
        },
        value: {
          type: "string",
          description: "Value in wei (hex or decimal string)",
        },
        data: {
          type: "string",
          description: "Calldata (0x-prefixed hex)",
        },
        chain_id: {
          type: "number",
          description: `Chain ID (default: ${defaultChainId})`,
        },
        gas_limit: {
          type: "number",
          description: "Gas limit (optional)",
        },
      },
      required: ["to"],
    },
    security: {
      level: "sign",
      confirmRequired: true,
    },
    async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
      const parseResult = WalletSendTxParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Invalid parameters: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
        };
      }

      const p = parseResult.data;
      const chainId = p.chain_id ?? defaultChainId;

      if (!ctx.requestConfirmation) {
        return {
          success: false,
          error: "Transaction rejected: confirmation callback is required for signing operations",
        };
      }

      const confirmed = await ctx.requestConfirmation({
        type: "transaction",
        title: "Confirm Transaction",
        description: `Send transaction to ${p.to} on chain ${chainId}. Confirm? [y/n]`,
        details: {
          To: p.to,
          Value: p.value ?? "0",
          Data: p.data ?? "(none)",
          "Chain ID": String(chainId),
        },
      });

      if (!confirmed) {
        log.info(`Transaction denied by user: to=${p.to}`);
        return {
          success: false,
          error: "Transaction cancelled by user",
        };
      }

      try {
        const client = getClawletClient(config.clawletConfig);
        const request: SendRawRequest = {
          to: p.to,
          chain_id: chainId,
          ...(p.value !== undefined && { value: p.value }),
          ...(p.data !== undefined && { data: p.data }),
          ...(p.gas_limit !== undefined && { gas_limit: p.gas_limit }),
        };

        const result = await client.sendRaw(request);

        log.info(`Transaction sent: ${result.tx_hash}`);
        return {
          success: true,
          data: {
            tx_hash: result.tx_hash,
            audit_id: result.audit_id,
            summary: `Transaction sent to ${p.to}. TX: ${result.tx_hash}`,
          },
        };
      } catch (err) {
        return handleClawletError(err, "send_raw");
      }
    },
  };
}

// ============================================================================
// Error Handling
// ============================================================================

function handleClawletError(err: unknown, operation: string): ToolResult {
  if (err instanceof ClawletError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return {
          success: false,
          error: "Clawlet authentication failed. Check auth token configuration.",
        };
      case "CONNECTION_FAILED":
        return {
          success: false,
          error: `Could not connect to Clawlet daemon. Is it running? (${err.message})`,
        };
      case "TIMEOUT":
        return {
          success: false,
          error: `Clawlet request timed out during ${operation}. The operation may still be pending.`,
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

// ============================================================================
// Factory: Create Both Wallet Tools
// ============================================================================

/**
 * Create both wallet tools with shared configuration.
 *
 * Tools are disabled if config.enabled is false.
 *
 * Usage in factory.ts:
 * ```ts
 * if (walletConfig?.enabled) {
 *   builtins.push(...createWalletTools(walletConfig));
 * }
 * ```
 */
export function createWalletTools(config: WalletToolsConfig): ToolDefinition[] {
  if (config.enabled === false) {
    log.debug("Wallet tools disabled by config");
    return [];
  }

  return [
    createWalletBalanceTool(config),
    createWalletTransferTool(config),
    createWalletSendTxTool(config),
  ];
}
