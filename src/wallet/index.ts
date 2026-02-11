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
  type AddressResponse,
  type AuthGrantRequest,
  type AuthGrantResponse,
  type SendRawRequest,
  type SendRawResponse,
} from "./clawlet-client.js";
