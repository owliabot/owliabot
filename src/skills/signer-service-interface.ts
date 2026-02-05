/**
 * Signer Service Interface - abstraction for executing signed operations
 * Used by SignerRouter to execute operations after policy approval
 * @see docs/design/skill-system.md Section 3.2
 */

import type { SignerTier } from "../signer/interface.js";

/**
 * Result of a signer operation
 */
export interface SignerResult {
  success: boolean;
  data?: {
    txHash?: string;
    chainId?: number;
    blockNumber?: number;
    gasUsed?: string;
    [key: string]: unknown;
  };
  error?: string;
}

/**
 * Parameters for a signer operation (generic, operation-specific)
 */
export interface SignerOperationParams {
  [key: string]: unknown;
}

/**
 * Signer Service interface - executes signed operations with the appropriate key tier
 *
 * Implementations should:
 * - Use session-key for Tier 2/3 operations (auto-sign capable)
 * - Use app (Companion App) for Tier 1 operations (requires user signature)
 * - Handle none tier by rejecting (no signer needed)
 */
export interface SignerService {
  /**
   * Execute a signer operation
   * @param operation - Operation name (e.g., 'transfer', 'approve', 'swap')
   * @param params - Operation-specific parameters
   * @param signerTier - Which signer tier to use
   * @returns Result of the operation
   */
  execute(
    operation: string,
    params: SignerOperationParams,
    signerTier: SignerTier
  ): Promise<SignerResult>;

  /**
   * Check if the service can execute with a given tier
   */
  canExecute(signerTier: SignerTier): boolean;

  /**
   * Get the current session key status (for Tier 2/3 operations)
   */
  getSessionKeyStatus(): Promise<SessionKeyStatus>;
}

/**
 * Session key status for escalation context
 */
export interface SessionKeyStatus {
  id?: string;
  available: boolean;
  expired: boolean;
  revoked: boolean;
  expiresAt?: number;
}

/**
 * Confirmation callback interface for inline confirmations (Tier 2)
 */
export interface ConfirmationCallback {
  /**
   * Request inline confirmation from the user
   * @param message - Formatted confirmation message
   * @returns True if user confirmed, false if rejected/timeout
   */
  askConfirmation(message: string): Promise<boolean>;
}

/**
 * Context provided to SignerRouter for each call
 */
export interface SignerRouterContext {
  userId: string;
  sessionId: string;
  channel: string;
  deviceId?: string;

  /**
   * Callback for inline confirmation (Tier 2)
   */
  askConfirmation: (message: string) => Promise<boolean>;

  /**
   * Send a message to the user (e.g., "Waiting for Companion App...")
   */
  sendMessage?: (message: string) => Promise<void>;

  /**
   * Track daily spending for escalation decisions
   */
  dailySpentUsd?: number;

  /**
   * Count of consecutive user rejections (for halt logic)
   */
  consecutiveDenials?: number;
}

/**
 * Signer call request from skills
 */
export interface SignerCall {
  /** Operation name, e.g., 'transfer', 'approve', 'swap' */
  operation: string;
  /** Operation-specific parameters */
  params: SignerOperationParams;
  /** Estimated USD value for tier escalation decisions */
  estimatedValueUsd?: number;
}

/**
 * Result from SignerRouter (extends SignerResult with audit info)
 */
export interface SignerRouterResult extends SignerResult {
  /** Audit entry ID for tracing */
  auditId?: string;
  /** Whether confirmation was required */
  confirmationRequired?: boolean;
  /** Effective tier used for execution */
  effectiveTier?: number | "none";
}
