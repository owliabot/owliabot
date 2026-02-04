import { describe, it, expect } from "vitest";
import type {
  SignerTier,
  SignerInterface,
  TransactionRequest,
  TransactionReceipt,
} from "../interface.js";

describe("signer interface", () => {
  it("should allow importing SignerTier type", () => {
    const tier1: SignerTier = "app";
    const tier2: SignerTier = "session-key";
    const tier3: SignerTier = "contract";

    expect(tier1).toBe("app");
    expect(tier2).toBe("session-key");
    expect(tier3).toBe("contract");
  });

  it("should allow importing TransactionRequest type", () => {
    const tx: TransactionRequest = {
      to: "0x1234567890123456789012345678901234567890",
      value: 1000000000000000000n,
      data: "0x",
      chainId: 1,
    };

    expect(tx.to).toBe("0x1234567890123456789012345678901234567890");
    expect(tx.chainId).toBe(1);
  });

  it("should allow importing TransactionReceipt type", () => {
    const receipt: TransactionReceipt = {
      hash: "0xabc123",
      blockNumber: 12345,
      status: "success",
    };

    expect(receipt.status).toBe("success");
  });

  it("should support optional transaction fields", () => {
    const tx: TransactionRequest = {
      to: "0x1234567890123456789012345678901234567890",
      chainId: 1,
      gasLimit: 21000n,
      maxFeePerGas: 2000000000n,
      maxPriorityFeePerGas: 1000000000n,
      nonce: 5,
    };

    expect(tx.gasLimit).toBe(21000n);
    expect(tx.nonce).toBe(5);
  });

  it("should support reverted transaction status", () => {
    const receipt: TransactionReceipt = {
      hash: "0xdef456",
      blockNumber: 12346,
      status: "reverted",
    };

    expect(receipt.status).toBe("reverted");
  });
});
