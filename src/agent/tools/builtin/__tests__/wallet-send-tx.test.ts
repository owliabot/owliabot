/**
 * wallet_send_tx Tool Tests
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createWalletSendTxTool } from "../wallet.js";
import type { ToolContext } from "../interface.js";
import * as walletModule from "../../../../wallet/index.js";

// Mock the wallet module
vi.mock("../../../../wallet/index.js", async () => {
  const actual = await vi.importActual<typeof walletModule>("../../../../wallet/index.js");
  return {
    ...actual,
    getClawletClient: vi.fn(),
    ClawletError: actual.ClawletError,
  };
});

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetClawletClient = walletModule.getClawletClient as ReturnType<typeof vi.fn>;
const TEST_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00";
const TEST_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function createMockContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionKey: "test-session",
    agentId: "test-agent",
    config: {},
    ...overrides,
  };
}

describe("wallet_send_tx tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it("has correct name and security settings", () => {
    const tool = createWalletSendTxTool({});
    expect(tool.name).toBe("wallet_send_tx");
    expect(tool.security.level).toBe("sign");
    expect(tool.security.confirmRequired).toBe(true);
  });

  it("requires 'to' parameter", () => {
    const tool = createWalletSendTxTool({});
    expect(tool.parameters.required).toEqual(["to"]);
  });

  // ── Address validation ────────────────────────────────────────────────────

  it("fails with missing 'to' address", async () => {
    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { value: "1000" },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });

  it("fails with invalid address format", async () => {
    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: "not-an-address" },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });

  // ── Successful send ───────────────────────────────────────────────────────

  it("sends transaction and returns tx_hash + audit_id", async () => {
    const mockResult = { tx_hash: "0xabc123", audit_id: "audit-456" };
    mockGetClawletClient.mockReturnValue({
      sendRaw: vi.fn().mockResolvedValue(mockResult),
    });

    const tool = createWalletSendTxTool({ defaultChainId: 8453 });
    const confirmFn = vi.fn().mockResolvedValue(true);

    const result = await tool.execute(
      { to: TEST_CONTRACT, data: "0xa9059cbb", value: "0", chain_id: 8453 },
      createMockContext({ requestConfirmation: confirmFn }),
    );

    expect(result.success).toBe(true);
    expect((result.data as any).tx_hash).toBe("0xabc123");
    expect((result.data as any).audit_id).toBe("audit-456");
    expect((result.data as any).summary).toContain("0xabc123");
  });

  it("sends value-only transaction without data", async () => {
    const mockResult = { tx_hash: "0xdef789", audit_id: "audit-789" };
    const mockClient = { sendRaw: vi.fn().mockResolvedValue(mockResult) };
    mockGetClawletClient.mockReturnValue(mockClient);

    const tool = createWalletSendTxTool({});
    await tool.execute(
      { to: TEST_ADDRESS, value: "1000000000000000000" },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    const callArg = mockClient.sendRaw.mock.calls[0][0];
    expect(callArg.to).toBe(TEST_ADDRESS);
    expect(callArg.value).toBe("1000000000000000000");
    expect(callArg.data).toBeUndefined();
  });

  // ── Default chain_id ──────────────────────────────────────────────────────

  it("uses 8453 as default chain_id", async () => {
    const mockClient = { sendRaw: vi.fn().mockResolvedValue({ tx_hash: "0x1", audit_id: "a1" }) };
    mockGetClawletClient.mockReturnValue(mockClient);

    const tool = createWalletSendTxTool({});
    await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(mockClient.sendRaw).toHaveBeenCalledWith(
      expect.objectContaining({ chain_id: 8453 }),
    );
  });

  it("uses custom default chain_id from config", async () => {
    const mockClient = { sendRaw: vi.fn().mockResolvedValue({ tx_hash: "0x1", audit_id: "a1" }) };
    mockGetClawletClient.mockReturnValue(mockClient);

    const tool = createWalletSendTxTool({ defaultChainId: 1 });
    await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(mockClient.sendRaw).toHaveBeenCalledWith(
      expect.objectContaining({ chain_id: 1 }),
    );
  });

  // ── Confirmation flow ─────────────────────────────────────────────────────

  it("requests confirmation before sending", async () => {
    mockGetClawletClient.mockReturnValue({
      sendRaw: vi.fn().mockResolvedValue({ tx_hash: "0x1", audit_id: "a1" }),
    });

    const confirmFn = vi.fn().mockResolvedValue(true);
    const tool = createWalletSendTxTool({});
    await tool.execute(
      { to: TEST_ADDRESS, value: "100" },
      createMockContext({ requestConfirmation: confirmFn }),
    );

    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction",
        title: "Confirm Transaction",
        details: expect.objectContaining({ To: TEST_ADDRESS }),
      }),
    );
  });

  it("cancels on user decline", async () => {
    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(false) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Transaction cancelled by user");
  });

  it("rejects without confirmation callback", async () => {
    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("confirmation callback is required");
  });

  // ── Clawlet error handling ────────────────────────────────────────────────

  it("handles CONNECTION_FAILED", async () => {
    mockGetClawletClient.mockReturnValue({
      sendRaw: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Connection refused", "CONNECTION_FAILED"),
      ),
    });

    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not connect to Clawlet daemon");
  });

  it("handles RPC_ERROR", async () => {
    mockGetClawletClient.mockReturnValue({
      sendRaw: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Nonce too low", "RPC_ERROR"),
      ),
    });

    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("RPC_ERROR");
    expect(result.error).toContain("Nonce too low");
  });

  it("handles UNAUTHORIZED", async () => {
    mockGetClawletClient.mockReturnValue({
      sendRaw: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Invalid token", "UNAUTHORIZED"),
      ),
    });

    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("authentication failed");
  });

  it("handles TIMEOUT", async () => {
    mockGetClawletClient.mockReturnValue({
      sendRaw: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Request timed out", "TIMEOUT"),
      ),
    });

    const tool = createWalletSendTxTool({});
    const result = await tool.execute(
      { to: TEST_ADDRESS },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("may still be pending");
  });
});
