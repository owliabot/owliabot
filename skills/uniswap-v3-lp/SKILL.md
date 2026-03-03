---
name: uniswap-v3-lp
description: |
  Create Uniswap V3 liquidity positions on Sepolia testnet.
  Use when the user asks to "add liquidity", "create LP position", "provide liquidity",
  "add LP on Uniswap", "create v3 position", or mentions Uniswap V3 LP.
  Transactions are signed and sent via Clawlet (private key never enters bot process).
version: 1.0.0
---

# Uniswap V3 LP Skill — Sepolia

Add concentrated liquidity positions on Uniswap V3 (Sepolia testnet) via Clawlet.

> **Security**: All transactions go through Clawlet's `send_raw` RPC. The bot never touches private keys.

## Overview

1. Gather user intent (token pair, amount, price range, fee tier)
2. Resolve token addresses on Sepolia
3. Check current pool state via on-chain calls
4. Encode the `mint()` calldata for NonfungiblePositionManager
5. Approve tokens if needed (ERC-20 approve → NonfungiblePositionManager)
6. Send the mint transaction via `wallet_send_tx` tool (Clawlet `send_raw`)
7. Report position NFT token ID and tx hash

## Contract Addresses (Sepolia, chain_id: 11155111)

See `references/sepolia-contracts.md` for full list. Key addresses:

| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| NonfungiblePositionManager | `0x1238536071E1c677A632429e3655c799b22cDA52` |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| QuoterV2 | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| WETH9 | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |

## Workflow

### Step 1: Gather LP Intent

Ask the user for:

| Parameter | Required | Default | Notes |
|-----------|----------|---------|-------|
| Token A | Yes | — | Symbol or 0x address |
| Token B | Yes | — | Symbol or 0x address |
| Amount A | Yes | — | Amount of token A to deposit |
| Fee Tier | No | 3000 (0.3%) | One of: 500, 3000, 10000 |
| Price Range | No | ±20% of current | minPrice / maxPrice or "full range" |

If the user says something like "add 0.1 ETH + USDC liquidity on sepolia", extract:
- Token A = WETH (native ETH wraps to WETH)
- Token B = USDC
- Amount A = 0.1

### Step 2: Resolve Tokens

Look up addresses in `references/sepolia-contracts.md`. Common Sepolia tokens:

| Symbol | Address |
|--------|---------|
| WETH | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| UNI | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` |

If user says "ETH", use WETH address and include a WETH wrapping step.

**Token ordering**: Uniswap V3 requires `token0 < token1` (numerically). Sort the pair:
```
if address(tokenA) > address(tokenB): swap them
token0 = lower address, token1 = higher address
```

### Step 3: Get Pool State

Use `cast` (foundry) via the `exec` tool to query on-chain:

```bash
# Get pool address from factory
cast call 0x0227628f3F023bb0B980b67D528571c95c6DaC1c \
  "getPool(address,address,uint24)(address)" \
  <token0> <token1> <fee> \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/demo
```

If pool returns `0x0000...0000`, the pool doesn't exist. Inform the user.

```bash
# Get current price (slot0)
cast call <pool_address> \
  "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/demo
```

Parse `sqrtPriceX96` (first value) and `tick` (second) from slot0.

**Price calculation**:
```
price = (sqrtPriceX96 / 2^96)^2
humanPrice = price * 10^(decimalsToken0 - decimalsToken1)
```

### Step 4: Calculate Ticks from Price Range

Convert user's price range to ticks:

```
tick = floor(log(price) / log(1.0001))
```

Round ticks to nearest `tickSpacing`:
- Fee 500 → tickSpacing 10
- Fee 3000 → tickSpacing 60
- Fee 10000 → tickSpacing 200

```
tickLower = floor(rawTick / tickSpacing) * tickSpacing
tickUpper = ceil(rawTick / tickSpacing) * tickSpacing
```

For **full range** (fee 3000):
- tickLower = -887220
- tickUpper = 887220

### Step 5: Calculate Liquidity & Amounts

Given the user deposits `amountA` of token A, calculate how much token B is needed.

Use the Uniswap V3 liquidity math — see `references/liquidity-math.md` for formulas.

Key logic:
- If current tick < tickLower: 100% token0 position
- If current tick > tickUpper: 100% token1 position
- In range: both tokens needed, ratio depends on current price within the range

### Step 6: Approve Tokens

Before minting, each ERC-20 token must approve the NonfungiblePositionManager.

```bash
# Generate approve calldata
cast calldata "approve(address,uint256)" \
  0x1238536071E1c677A632429e3655c799b22cDA52 \
  <amount_in_wei>
```

Send via `wallet_send_tx` tool:
```json
{
  "to": "<token_address>",
  "data": "<approve_calldata>",
  "chain_id": 11155111,
  "value": "0"
}
```

**Skip approval for native ETH** — when using ETH, send `value` with the mint tx.

### Step 7: Encode & Send Mint Transaction

NonfungiblePositionManager `mint()` struct:

```solidity
struct MintParams {
    address token0;        // lower address
    address token1;        // higher address
    uint24 fee;            // 500, 3000, or 10000
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;    // 0 for testnet
    uint256 amount1Min;    // 0 for testnet
    address recipient;     // user wallet (get from Clawlet `address` call)
    uint256 deadline;      // current timestamp + 600
}
```

```bash
# Generate mint calldata
cast calldata \
  "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))" \
  "(<token0>,<token1>,<fee>,<tickLower>,<tickUpper>,<amount0Desired>,<amount1Desired>,0,0,<recipient>,<deadline>)"
```

Send via `wallet_send_tx`:
```json
{
  "to": "0x1238536071E1c677A632429e3655c799b22cDA52",
  "data": "<mint_calldata>",
  "chain_id": 11155111,
  "value": "0",
  "gas_limit": 500000
}
```

If using native ETH (one token is WETH):
- Use `multicall` to batch `mint()` + `refundETH()`
- Set `value` = ETH amount in wei
- Use WETH address as token0/token1

### Step 8: Report Result

After tx confirms, report:

```
✅ LP Position Created on Sepolia!

Pool: WETH/USDC (0.3%)
Range: 2800 - 3600 USDC/ETH
Deposited: 0.1 WETH + ~320 USDC
TX: 0xabc...def

View: https://sepolia.etherscan.io/tx/<tx_hash>
```

## Tools Used

| Tool | Purpose |
|------|---------|
| `wallet_balance` | Check token balances before deposit |
| `wallet_send_tx` | Send approve + mint transactions via Clawlet |
| `exec` | Run `cast` for on-chain reads (slot0, getPool, etc.) |
| `read-file` | Read reference files for addresses/ABI |

## Fee Tier Reference

| Fee | Tick Spacing | Best For |
|-----|-------------|----------|
| 500 (0.05%) | 10 | Stablecoin pairs |
| 3000 (0.3%) | 60 | Most pairs (default) |
| 10000 (1.0%) | 200 | Exotic/volatile pairs |

## Safety

- **Testnet only**: Sepolia (chain_id: 11155111). Do NOT use mainnet addresses.
- **Slippage**: `amount0Min`/`amount1Min` = 0 on testnet. Use 95%+ on mainnet.
- **Deadline**: Always set (timestamp + 600s).
- **Private key safety**: All signing via Clawlet. Never handle private keys.

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Pool does not exist | No pool for pair+fee | Try different fee tier |
| Insufficient balance | Not enough tokens | Check `wallet_balance` first |
| STF (SafeTransferFrom) | Token not approved | Run approve first |
| Clawlet CONNECTION_FAILED | Daemon not running | Start clawlet |
| Clawlet UNAUTHORIZED | Bad auth token | Re-auth with clawlet |

## Limitations (V1)

- No pool creation (existing pools only)
- No position management (increase/decrease/collect/remove)
- Sepolia testnet only
- No Permit2 support
