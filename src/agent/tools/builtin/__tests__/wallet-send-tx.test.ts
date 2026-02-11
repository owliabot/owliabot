/**
 * Wallet Send TX Tool Tests
 *
 * Unit tests for wallet_send_tx tool (raw transaction sending).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createWalletSendTxTool } from "../wallet.js";
import type { ToolContext } from "../../interface.js";
import * as walletModule from "../../../../wallet/index.js";

// Mock the wallet module
vi.mock("../../../../wallet/index.js", async () => {
  const actual = await vi.importActual<typeof walletModule>("../../../../wallet/index.js");
  return {
    ...actual,
    getClawletClient: vi.fn(),
  };
});

describe("wallet_send_tx tool", () => {
  const mockSendRaw = vi.fn();
  const mockClient = { sendRaw: mockSendRaw };
  const mockRequestConfirmation = vi.fn();

  const VALID_ADDRESS = "0x1234567890123456789012345678901234567890";

  const createMockCtx = (overrides: Partial<ToolContext> = {}): ToolContext =>
    ({
      sessionKey: "test-session",
      agentId: "test-agent",
      signer: null,
      config: {},
      requestConfirmation: mockRequestConfirmation,
      ...overrides,
    }) as ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(walletModule.getClawletClient).mockReturnValue(mockClient as any);
    mockRequestConfirmation.mockResolvedValue(true);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      const tool = createWalletSendTxTool();
      expect(tool.name).toBe("wallet_send_tx");
    });

    it("should have sign security level", () => {
      const tool = createWalletSendTxTool();
      expect(tool.security.level).toBe("sign");
    });

    it("should require confirmation", () => {
      const tool = createWalletSendTxTool();
      expect(tool.security.confirmRequired).toBe(true);
    });

    it("should require only 'to' parameter", () => {
      const tool = createWalletSendTxTool();
      expect(tool.parameters.required).toEqual(["to"]);
    });
  });

  describe("address validation", () => {
    it("should return error for missing 'to' address", async () => {
      const tool = createWalletSendTxTool();
      const result = await tool.execute({}, createMockCtx());

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameters");
    });

    it("should return error for invalid address format", async () => {
      const tool = createWalletSendTxTool();
      const result = await tool.execute({ to: "0x1234" }, createMockCtx());

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameters");
    });
  });

  describe("successful send", () => {
    it("should return tx_hash and audit_id on success", async () => {
      mockSendRaw.mockResolvedValue({
        tx_hash: "0xabc123def456",
        audit_id: "audit-789",
      });

      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        {
          to: VALID_ADDRESS,
          data: "0xa9059cbb",
          chain_id: 8453,
        },
        createMockCtx(),
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        tx_hash: "0xabc123def456",
        audit_id: "audit-789",
      });
      expect((result.data as any).summary).toContain("0xabc123def456");
    });

    it("should send with value only (no data)", async () => {
      mockSendRaw.mockResolvedValue({
        tx_hash: "0x111",
        audit_id: "audit-222",
      });

      const tool = createWalletSendTxTool();
      await tool.execute(
        {
          to: VALID_ADDRESS,
          value: "1000000000000000000",
        },
        createMockCtx(),
      );

      expect(mockSendRaw).toHaveBeenCalledWith({
        to: VALID_ADDRESS,
        value: "1000000000000000000",
        chain_id: 8453,
      });
    });
  });

  describe("default chain_id", () => {
    it("should use default chain_id (8453) when not specified", async () => {
      mockSendRaw.mockResolvedValue({ tx_hash: "0x123", audit_id: "a1" });

      const tool = createWalletSendTxTool();
      await tool.execute({ to: VALID_ADDRESS }, createMockCtx());

      expect(mockSendRaw).toHaveBeenCalledWith(
        expect.objectContaining({ chain_id: 8453 }),
      );
    });

    it("should use custom default chain_id from config", async () => {
      mockSendRaw.mockResolvedValue({ tx_hash: "0x123", audit_id: "a1" });

      const tool = createWalletSendTxTool({ defaultChainId: 1 });
      await tool.execute({ to: VALID_ADDRESS }, createMockCtx());

      expect(mockSendRaw).toHaveBeenCalledWith(
        expect.objectContaining({ chain_id: 1 }),
      );
    });
  });

  describe("confirmation flow", () => {
    it("should request confirmation before sending", async () => {
      mockSendRaw.mockResolvedValue({ tx_hash: "0x123", audit_id: "a1" });

      const tool = createWalletSendTxTool();
      await tool.execute(
        { to: VALID_ADDRESS, value: "100", data: "0xabcd" },
        createMockCtx(),
      );

      expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
      const confirmReq = mockRequestConfirmation.mock.calls[0][0];
      expect(confirmReq.type).toBe("transaction");
      expect(confirmReq.title).toBe("Confirm Transaction");
      expect(confirmReq.details.To).toBe(VALID_ADDRESS);
    });

    it("should cancel when user declines confirmation", async () => {
      mockRequestConfirmation.mockResolvedValue(false);

      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        { to: VALID_ADDRESS },
        createMockCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Transaction cancelled by user");
      expect(mockSendRaw).not.toHaveBeenCalled();
    });

    it("should reject when confirmation callback is not available", async () => {
      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        { to: VALID_ADDRESS },
        createMockCtx({ requestConfirmation: undefined }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("confirmation callback is required");
    });
  });

  describe("Clawlet error handling", () => {
    it("should handle CONNECTION_FAILED error", async () => {
      mockSendRaw.mockRejectedValue(
        new walletModule.ClawletError("Socket not found", "CONNECTION_FAILED"),
      );

      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        { to: VALID_ADDRESS },
        createMockCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not connect to Clawlet");
    });

    it("should handle RPC_ERROR (policy denial)", async () => {
      mockSendRaw.mockRejectedValue(
        new walletModule.ClawletError("Policy denied", "RPC_ERROR"),
      );

      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        { to: VALID_ADDRESS },
        createMockCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Clawlet error");
      expect(result.error).toContain("RPC_ERROR");
    });

    it("should handle UNAUTHORIZED error", async () => {
      mockSendRaw.mockRejectedValue(
        new walletModule.ClawletError("Auth failed", "UNAUTHORIZED"),
      );

      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        { to: VALID_ADDRESS },
        createMockCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("authentication failed");
    });

    it("should handle TIMEOUT error", async () => {
      mockSendRaw.mockRejectedValue(
        new walletModule.ClawletError("Request timeout", "TIMEOUT"),
      );

      const tool = createWalletSendTxTool();
      const result = await tool.execute(
        { to: VALID_ADDRESS },
        createMockCtx(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });
  });
});
