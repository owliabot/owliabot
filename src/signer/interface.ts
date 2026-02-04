/**
 * Signer interface - 3-tier key security model
 * @see design.md Section 5.3
 */

export type SignerTier = "app" | "session-key" | "contract" | "none";

export interface SignerInterface {
  getAddress(): Promise<string>;
  signMessage(message: string): Promise<string>;
  signTransaction(tx: TransactionRequest): Promise<string>;
  sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt>;

  tier: SignerTier;
  canAutoSign: boolean;
  maxAutoSignValue: bigint;
}

export interface TransactionRequest {
  to: string;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  chainId: number;
}

export interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  status: "success" | "reverted";
}
