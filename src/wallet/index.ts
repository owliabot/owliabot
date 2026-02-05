/**
 * Wallet module - Clawlet integration
 */

export {
  ClawletClient,
  ClawletError,
  getClawletClient,
  resetClawletClient,
  type ClawletClientConfig,
  type BalanceQuery,
  type BalanceResponse,
  type TokenBalance,
  type TransferRequest,
  type TransferResponse,
  type HealthResponse,
  type AuthGrantRequest,
  type AuthGrantResponse,
} from "./clawlet-client.js";
