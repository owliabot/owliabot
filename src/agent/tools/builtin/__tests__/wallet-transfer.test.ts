/**
 * Wallet Transfer Tool Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWalletTransferTool } from "../wallet-transfer.js";
import type { ToolContext, ConfirmationRequest } from "../../interface.js";
import * as clawletModule from "../../../../wallet/index.js";

// Mock the clawlet module
vi.mock("../../../../wallet/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof clawletModule>();
  return {
    ...actual,
    getClawletClient: vi.fn(),
  };
});

describe("wallet_transfer tool", () => {
  const mockTransfer = vi.fn();
  const mockClient = { transfer: mockTransfer };
  const mockRequestConfirmation = vi.fn();

  const createMockCtx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
    sessionKey: "test-session",
    agentId: "test-agent",
    signer: null,
    config: {},
    requestConfirmation: mockRequestConfirmation,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clawletModule.getClawletClient).mockReturnValue(mockClient as any);
    mockRequestConfirmation.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful transfer", () => {
    it("should return success data on successful transfer", async () => {
      mockTransfer.mockResolvedValue({
        status: "success",
        tx_hash: "0xabc123def456",
        audit_id: "audit-789",
      });

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.5",
          token: "ETH",
          chain_id: 8453,
        },
        createMockCtx()
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: "success",
        tx_hash: "0xabc123def456",
        audit_id: "audit-789",
      });
      expect((result.data as any).summary).toContain("Successfully transferred");
      expect((result.data as any).summary).toContain("1.5 ETH");
      expect((result.data as any).summary).toContain("0xabc123def456");
    });

    it("should handle ERC-20 token transfer", async () => {
      mockTransfer.mockResolvedValue({
        status: "success",
        tx_hash: "0xtoken123",
        audit_id: "audit-token",
      });

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "100",
          token: "USDC",
          chain_id: 8453,
        },
        createMockCtx()
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        amount: "100",
        token: "USDC",
        chain_id: 8453,
      });
    });

    it("should normalize ETH token to uppercase", async () => {
      mockTransfer.mockResolvedValue({
        status: "success",
        tx_hash: "0x123",
      });

      const tool = createWalletTransferTool();
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "eth", // lowercase
        },
        createMockCtx()
      );

      expect(mockTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "ETH",
        })
      );
    });
  });

  describe("transfer denied by policy", () => {
    it("should return error when transfer is denied", async () => {
      mockTransfer.mockResolvedValue({
        status: "denied",
        reason: "Daily limit exceeded",
      });

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1000",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Transfer denied");
      expect(result.error).toContain("Daily limit exceeded");
    });

    it("should show default message when no reason provided", async () => {
      mockTransfer.mockResolvedValue({
        status: "denied",
      });

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "100",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Policy violation");
    });
  });

  describe("address validation", () => {
    it("should return error for missing recipient address", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        { amount: "1.0", token: "ETH" },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid recipient address");
    });

    it("should return error for invalid recipient address", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid recipient address");
      expect(result.error).toContain("0x-prefixed");
    });

    it("should return error for address without 0x prefix", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid recipient address");
    });
  });

  describe("amount validation", () => {
    it("should return error for missing amount", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid amount");
    });

    it("should return error for non-numeric amount", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "not-a-number",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid amount");
    });

    it("should return error for zero amount", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid amount");
      expect(result.error).toContain("positive");
    });

    it("should return error for negative amount", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "-1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid amount");
    });

    it("should accept decimal amounts", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "0.001",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(true);
    });
  });

  describe("token validation", () => {
    it("should return error for missing token", async () => {
      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Token is required");
    });

    it("should accept token contract address", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "100",
          token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC address
        },
        createMockCtx()
      );

      expect(mockTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        })
      );
    });
  });

  describe("default chain_id", () => {
    it("should use default chain_id (8453) when not specified", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(mockTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          chain_id: 8453,
        })
      );
    });

    it("should use custom default chain_id from deps", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool({ defaultChainId: 1 });
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(mockTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          chain_id: 1,
        })
      );
    });
  });

  describe("confirmation flow", () => {
    it("should request confirmation before transfer", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.5",
          token: "ETH",
          chain_id: 8453,
        },
        createMockCtx()
      );

      expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
      const confirmReq = mockRequestConfirmation.mock.calls[0][0] as ConfirmationRequest;

      expect(confirmReq.type).toBe("transaction");
      expect(confirmReq.title).toBe("Confirm Transfer");
      expect(confirmReq.description).toContain("1.5 ETH");
      expect(confirmReq.details).toMatchObject({
        Recipient: "0x1234567890123456789012345678901234567890",
        Amount: "1.5",
        Token: "ETH",
        "Chain ID": "8453",
      });
    });

    it("should cancel transfer when user declines confirmation", async () => {
      mockRequestConfirmation.mockResolvedValue(false);

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Transfer cancelled by user");
      expect(mockTransfer).not.toHaveBeenCalled();
    });

    it("should proceed without confirmation when not available", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx({ requestConfirmation: undefined })
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalled();
    });

    it("should include transaction data in confirmation for ETH", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.5",
          token: "ETH",
          chain_id: 8453,
        },
        createMockCtx()
      );

      const confirmReq = mockRequestConfirmation.mock.calls[0][0] as ConfirmationRequest;
      expect(confirmReq.transaction).toBeDefined();
      expect(confirmReq.transaction?.to).toBe("0x1234567890123456789012345678901234567890");
      expect(confirmReq.transaction?.chainId).toBe(8453);
      // 1.5 ETH = 1.5e18 wei
      expect(confirmReq.transaction?.value).toBe(1500000000000000000n);
    });

    it("should set value to 0 for ERC-20 token transfers", async () => {
      mockTransfer.mockResolvedValue({ status: "success", tx_hash: "0x123" });

      const tool = createWalletTransferTool();
      await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "100",
          token: "USDC",
          chain_id: 8453,
        },
        createMockCtx()
      );

      const confirmReq = mockRequestConfirmation.mock.calls[0][0] as ConfirmationRequest;
      expect(confirmReq.transaction?.value).toBe(0n);
    });
  });

  describe("Clawlet error handling", () => {
    it("should handle UNAUTHORIZED error", async () => {
      mockTransfer.mockRejectedValue(
        new clawletModule.ClawletError("Auth failed", "UNAUTHORIZED")
      );

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("authentication failed");
    });

    it("should handle CONNECTION_FAILED error", async () => {
      mockTransfer.mockRejectedValue(
        new clawletModule.ClawletError("Socket not found", "CONNECTION_FAILED")
      );

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not connect to Clawlet");
      expect(result.error).toContain("daemon running");
    });

    it("should handle TIMEOUT error", async () => {
      mockTransfer.mockRejectedValue(
        new clawletModule.ClawletError("Request timeout", "TIMEOUT")
      );

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
      expect(result.error).toContain("still be pending");
    });

    it("should handle RPC_ERROR", async () => {
      mockTransfer.mockRejectedValue(
        new clawletModule.ClawletError("Invalid method", "RPC_ERROR")
      );

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Clawlet error");
      expect(result.error).toContain("RPC_ERROR");
    });

    it("should handle generic Error", async () => {
      mockTransfer.mockRejectedValue(new Error("Network error"));

      const tool = createWalletTransferTool();
      const result = await tool.execute(
        {
          to: "0x1234567890123456789012345678901234567890",
          amount: "1.0",
          token: "ETH",
        },
        createMockCtx()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      const tool = createWalletTransferTool();
      expect(tool.name).toBe("wallet_transfer");
    });

    it("should have sign security level", () => {
      const tool = createWalletTransferTool();
      expect(tool.security.level).toBe("sign");
    });

    it("should require confirmation", () => {
      const tool = createWalletTransferTool();
      expect(tool.security.confirmRequired).toBe(true);
    });

    it("should require to, amount, and token parameters", () => {
      const tool = createWalletTransferTool();
      expect(tool.parameters.required).toContain("to");
      expect(tool.parameters.required).toContain("amount");
      expect(tool.parameters.required).toContain("token");
    });

    it("should include warning in description", () => {
      const tool = createWalletTransferTool();
      expect(tool.description).toContain("SIGN-level");
      expect(tool.description).toContain("confirmation");
    });
  });
});
