/**
 * Wallet module - Clawlet integration
 */

export {
  ClawletClient,
  ClawletError,
  getClawletClient,
  resetClawletClient,
  resolveClawletBaseUrl,
  DEFAULT_BASE_URL,
  type ClawletClientConfig,
  type BalanceQuery,
  type BalanceResponse,
  type TokenBalance,
  type TransferRequest,
  type TransferResponse,
  type SendRawRequest,
  type SendRawResponse,
  type HealthResponse,
  type AddressResponse,
  type AuthGrantRequest,
  type AuthGrantResponse,
} from "./clawlet-client.js";
