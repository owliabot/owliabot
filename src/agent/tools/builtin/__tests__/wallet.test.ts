/**
 * Wallet Tools Tests
 *
 * Unit tests for wallet_balance and wallet_transfer tools.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createWalletBalanceTool,
  createWalletTransferTool,
  createWalletTools,
} from "../wallet.js";
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

// Mock logger
vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetClawletClient = walletModule.getClawletClient as ReturnType<typeof vi.fn>;
const TEST_ADDRESS_1 = "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00";
const TEST_ADDRESS_2 = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const TEST_ADDRESS_3 = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TEST_ADDRESS_4 = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function createMockContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionKey: "test-session",
    agentId: "test-agent",
    config: {},
    ...overrides,
  };
}

describe("wallet_balance tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries balance with provided address", async () => {
    const mockBalance = {
      eth: "1.5",
      tokens: [{ symbol: "USDC", balance: "100.0", address: "0xusdc" }],
    };
    mockGetClawletClient.mockReturnValue({
      balance: vi.fn().mockResolvedValue(mockBalance),
    });

    const tool = createWalletBalanceTool({ defaultChainId: 8453 });
    const result = await tool.execute(
      { address: TEST_ADDRESS_1 },
      createMockContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      address: TEST_ADDRESS_1,
      chain_id: 8453,
      eth: "1.5",
    });
    expect((result.data as any).summary).toContain("ETH: 1.5");
    expect((result.data as any).summary).toContain("USDC: 100.0");
  });

  it("uses default address when not provided", async () => {
    const mockBalance = { eth: "2.0", tokens: [] };
    const mockClient = { balance: vi.fn().mockResolvedValue(mockBalance) };
    mockGetClawletClient.mockReturnValue(mockClient);

    const defaultAddr = TEST_ADDRESS_2;
    const tool = createWalletBalanceTool({
      defaultAddress: defaultAddr,
      defaultChainId: 1,
    });

    const result = await tool.execute({}, createMockContext());

    expect(result.success).toBe(true);
    expect(mockClient.balance).toHaveBeenCalledWith({
      address: defaultAddr,
      chain_id: 1,
    });
  });

  it("uses default chain_id when not provided", async () => {
    const mockBalance = { eth: "0.5", tokens: [] };
    const mockClient = { balance: vi.fn().mockResolvedValue(mockBalance) };
    mockGetClawletClient.mockReturnValue(mockClient);

    const tool = createWalletBalanceTool({ defaultChainId: 42161 });
    await tool.execute(
      { address: TEST_ADDRESS_1 },
      createMockContext(),
    );

    expect(mockClient.balance).toHaveBeenCalledWith({
      address: TEST_ADDRESS_1,
      chain_id: 42161,
    });
  });

  it("fails when address not provided and no default", async () => {
    const tool = createWalletBalanceTool({});
    const result = await tool.execute({}, createMockContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Address is required");
  });

  it("fails with invalid address format", async () => {
    const tool = createWalletBalanceTool({});
    const result = await tool.execute(
      { address: "not-a-valid-address" },
      createMockContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });

  it("handles connection errors gracefully", async () => {
    mockGetClawletClient.mockReturnValue({
      balance: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Socket not found", "CONNECTION_FAILED"),
      ),
    });

    const tool = createWalletBalanceTool({
      defaultAddress: TEST_ADDRESS_1,
    });
    const result = await tool.execute({}, createMockContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not connect to Clawlet daemon");
  });

  it("handles auth errors", async () => {
    mockGetClawletClient.mockReturnValue({
      balance: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Invalid token", "UNAUTHORIZED"),
      ),
    });

    const tool = createWalletBalanceTool({
      defaultAddress: TEST_ADDRESS_1,
    });
    const result = await tool.execute({}, createMockContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("authentication failed");
  });
});

describe("wallet_transfer tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes transfer with confirmation", async () => {
    const mockTransfer = {
      status: "success",
      tx_hash: "0xtxhash123",
      audit_id: "audit-123",
    };
    mockGetClawletClient.mockReturnValue({
      transfer: vi.fn().mockResolvedValue(mockTransfer),
    });

    const tool = createWalletTransferTool({ defaultChainId: 8453 });
    const confirmFn = vi.fn().mockResolvedValue(true);

    const result = await tool.execute(
      {
        to: TEST_ADDRESS_2,
        amount: "0.5",
        token: "ETH",
      },
      createMockContext({ requestConfirmation: confirmFn }),
    );

    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transaction",
        title: "Confirm Transfer",
        description: expect.stringContaining("Transfer 0.5 ETH"),
      }),
    );
    expect(result.success).toBe(true);
    expect((result.data as any).tx_hash).toBe("0xtxhash123");
  });

  it("uses ETH as default token", async () => {
    const mockClient = {
      transfer: vi.fn().mockResolvedValue({
        status: "success",
        tx_hash: "0x123",
      }),
    };
    mockGetClawletClient.mockReturnValue(mockClient);

    const tool = createWalletTransferTool({ defaultChainId: 8453 });
    await tool.execute(
      {
        to: TEST_ADDRESS_2,
        amount: "1.0",
      },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(mockClient.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ token_type: "ETH" }),
    );
  });

  it("cancels transfer when user denies confirmation", async () => {
    const tool = createWalletTransferTool({});
    const confirmFn = vi.fn().mockResolvedValue(false);

    const result = await tool.execute(
      {
        to: TEST_ADDRESS_2,
        amount: "100",
        token: "USDC",
      },
      createMockContext({ requestConfirmation: confirmFn }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Transfer cancelled by user");
  });

  it("returns denial reason when policy rejects transfer", async () => {
    mockGetClawletClient.mockReturnValue({
      transfer: vi.fn().mockResolvedValue({
        status: "denied",
        reason: "Daily limit exceeded",
      }),
    });

    const tool = createWalletTransferTool({});
    const result = await tool.execute(
      {
        to: TEST_ADDRESS_2,
        amount: "1000",
        token: "ETH",
      },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Daily limit exceeded");
  });

  it("fails with invalid recipient address", async () => {
    const tool = createWalletTransferTool({});
    const result = await tool.execute(
      { to: "invalid", amount: "1.0", token: "ETH" },
      createMockContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });

  it("fails with invalid amount", async () => {
    const tool = createWalletTransferTool({});
    const result = await tool.execute(
      {
        to: TEST_ADDRESS_3,
        amount: "-1",
        token: "ETH",
      },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });

  it("handles timeout errors", async () => {
    mockGetClawletClient.mockReturnValue({
      transfer: vi.fn().mockRejectedValue(
        new walletModule.ClawletError("Request timed out", "TIMEOUT"),
      ),
    });

    const tool = createWalletTransferTool({});
    const result = await tool.execute(
      {
        to: TEST_ADDRESS_4,
        amount: "0.1",
        token: "ETH",
      },
      createMockContext({ requestConfirmation: vi.fn().mockResolvedValue(true) }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("may still be pending");
  });

  it("has correct security settings", () => {
    const tool = createWalletTransferTool({});

    expect(tool.security.level).toBe("sign");
    expect(tool.security.confirmRequired).toBe(true);
  });

  it("fails closed when confirmation callback is missing", async () => {
    const tool = createWalletTransferTool({});
    const result = await tool.execute(
      {
        to: TEST_ADDRESS_2,
        amount: "1.0",
        token: "ETH",
      },
      createMockContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("confirmation callback is required");
  });

  it("rejects non-decimal amount strings", async () => {
    const tool = createWalletTransferTool({});
    const confirmFn = vi.fn().mockResolvedValue(true);

    for (const invalid of ["Infinity", "NaN", "-1", "0x10", "1.0abc"]) {
      const result = await tool.execute(
        {
          to: TEST_ADDRESS_2,
          amount: invalid,
          token: "ETH",
        },
        createMockContext({ requestConfirmation: confirmFn }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameters");
    }
  });
});

describe("createWalletTools factory", () => {
  it("creates both tools when enabled", () => {
    const tools = createWalletTools({ enabled: true, defaultChainId: 8453 });

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["wallet_balance", "wallet_transfer"]);
  });

  it("returns empty array when disabled", () => {
    const tools = createWalletTools({ enabled: false });

    expect(tools).toEqual([]);
  });

  it("is enabled by default when enabled is not specified", () => {
    const tools = createWalletTools({ defaultChainId: 8453 });

    expect(tools).toHaveLength(2);
  });
});
