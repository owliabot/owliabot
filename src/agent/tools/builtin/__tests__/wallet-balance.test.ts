/**
 * Wallet Balance Tool Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWalletBalanceTool } from "../wallet-balance.js";
import type { ToolContext } from "../../interface.js";
import * as clawletModule from "../../../../wallet/index.js";

// Mock the clawlet module
vi.mock("../../../../wallet/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof clawletModule>();
  return {
    ...actual,
    getClawletClient: vi.fn(),
  };
});

describe("wallet_balance tool", () => {
  const mockBalance = vi.fn();
  const mockClient = { balance: mockBalance };
  const mockCtx = {} as ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clawletModule.getClawletClient).mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful balance query", () => {
    it("should return balance data on success", async () => {
      mockBalance.mockResolvedValue({
        eth: "1.5",
        tokens: [
          { symbol: "USDC", balance: "100.0", address: "0xUSDC" },
          { symbol: "DAI", balance: "50.0", address: "0xDAI" },
        ],
      });

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        {
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 8453,
        },
        mockCtx
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
        eth: "1.5",
        tokens: [
          { symbol: "USDC", balance: "100.0", address: "0xUSDC" },
          { symbol: "DAI", balance: "50.0", address: "0xDAI" },
        ],
      });
      expect((result.data as any).summary).toContain("ETH: 1.5");
      expect((result.data as any).summary).toContain("USDC: 100.0");
    });

    it("should handle empty token list", async () => {
      mockBalance.mockResolvedValue({
        eth: "0.5",
        tokens: [],
      });

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        {
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 1,
        },
        mockCtx
      );

      expect(result.success).toBe(true);
      expect((result.data as any).summary).toContain("No tracked tokens");
    });
  });

  describe("default chain_id", () => {
    it("should use default chain_id (8453) when not specified", async () => {
      mockBalance.mockResolvedValue({ eth: "1.0", tokens: [] });

      const tool = createWalletBalanceTool();
      await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(mockBalance).toHaveBeenCalledWith({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 8453,
      });
    });

    it("should use custom default chain_id from deps", async () => {
      mockBalance.mockResolvedValue({ eth: "1.0", tokens: [] });

      const tool = createWalletBalanceTool({ defaultChainId: 1 });
      await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(mockBalance).toHaveBeenCalledWith({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 1,
      });
    });

    it("should override default with explicit chain_id", async () => {
      mockBalance.mockResolvedValue({ eth: "1.0", tokens: [] });

      const tool = createWalletBalanceTool({ defaultChainId: 1 });
      await tool.execute(
        {
          address: "0x1234567890123456789012345678901234567890",
          chain_id: 42161,
        },
        mockCtx
      );

      expect(mockBalance).toHaveBeenCalledWith({
        address: "0x1234567890123456789012345678901234567890",
        chain_id: 42161,
      });
    });
  });

  describe("address validation", () => {
    it("should return error for missing address", async () => {
      const tool = createWalletBalanceTool();
      const result = await tool.execute({}, mockCtx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid address");
    });

    it("should return error for empty address", async () => {
      const tool = createWalletBalanceTool();
      const result = await tool.execute({ address: "" }, mockCtx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid address");
    });

    it("should return error for address without 0x prefix", async () => {
      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid address format");
      expect(result.error).toContain("0x-prefixed");
    });

    it("should return error for address with wrong length", async () => {
      const tool = createWalletBalanceTool();
      const result = await tool.execute({ address: "0x1234" }, mockCtx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid address format");
    });

    it("should return error for address with invalid characters", async () => {
      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0xGGGG567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid address format");
    });

    it("should accept valid checksummed address", async () => {
      mockBalance.mockResolvedValue({ eth: "1.0", tokens: [] });

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0xABCDEF1234567890abcdef1234567890ABCDEF12" },
        mockCtx
      );

      expect(result.success).toBe(true);
    });
  });

  describe("Clawlet error handling", () => {
    it("should handle ClawletError with code", async () => {
      mockBalance.mockRejectedValue(
        new clawletModule.ClawletError("Connection failed", "CONNECTION_FAILED")
      );

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Clawlet error");
      expect(result.error).toContain("CONNECTION_FAILED");
      expect(result.error).toContain("Connection failed");
    });

    it("should handle UNAUTHORIZED error", async () => {
      mockBalance.mockRejectedValue(
        new clawletModule.ClawletError("Auth token required", "UNAUTHORIZED")
      );

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("UNAUTHORIZED");
    });

    it("should handle TIMEOUT error", async () => {
      mockBalance.mockRejectedValue(
        new clawletModule.ClawletError("Request timeout", "TIMEOUT")
      );

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("TIMEOUT");
    });

    it("should handle generic Error", async () => {
      mockBalance.mockRejectedValue(new Error("Something went wrong"));

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Something went wrong");
    });

    it("should handle non-Error rejection", async () => {
      mockBalance.mockRejectedValue("string error");

      const tool = createWalletBalanceTool();
      const result = await tool.execute(
        { address: "0x1234567890123456789012345678901234567890" },
        mockCtx
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      const tool = createWalletBalanceTool();
      expect(tool.name).toBe("wallet_balance");
    });

    it("should have read security level", () => {
      const tool = createWalletBalanceTool();
      expect(tool.security.level).toBe("read");
    });

    it("should require address parameter", () => {
      const tool = createWalletBalanceTool();
      expect(tool.parameters.required).toContain("address");
    });

    it("should include chain_id in parameters", () => {
      const tool = createWalletBalanceTool();
      expect(tool.parameters.properties).toHaveProperty("chain_id");
    });

    it("should show fallback text when no chains provided", () => {
      const tool = createWalletBalanceTool();
      expect(tool.description).toContain("query wallet service for current supported chains");
    });

    it("should include dynamic chain list when chains are provided", () => {
      const tool = createWalletBalanceTool({
        supportedChains: [
          { chain_id: 8453, name: "Base" },
          { chain_id: 1, name: "Ethereum Mainnet" },
          { chain_id: 11155111, name: "Sepolia", testnet: true },
        ],
      });
      expect(tool.description).toContain("8453: Base");
      expect(tool.description).toContain("1: Ethereum Mainnet");
      expect(tool.description).toContain("11155111: Sepolia (testnet)");
    });
  });
});
