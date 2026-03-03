# Uniswap V3 Liquidity Math Reference

## Core Concepts

### sqrtPriceX96

Uniswap V3 stores prices as `sqrtPriceX96 = sqrt(price) * 2^96`.

To convert:
```
price = (sqrtPriceX96 / 2^96)^2
```

Adjust for decimals:
```
humanPrice = price * 10^(token0Decimals - token1Decimals)
```

### Ticks

Each tick represents a 0.01% price change:
```
price(tick) = 1.0001^tick
tick(price) = floor(log(price) / log(1.0001))
```

## Tick Spacing by Fee Tier

| Fee (bips) | Fee % | Tick Spacing | Min Tick | Max Tick |
|------------|-------|-------------|----------|----------|
| 500 | 0.05% | 10 | -887270 | 887270 |
| 3000 | 0.30% | 60 | -887220 | 887220 |
| 10000 | 1.00% | 200 | -887200 | 887200 |

Round ticks to spacing:
```
tickLower = floor(rawTick / spacing) * spacing
tickUpper = ceil(rawTick / spacing) * spacing
```

## Liquidity Calculation

Given: deposit `amount0` of token0, with price range [tickLower, tickUpper] and current tick.

### Helper: sqrtRatio at tick
```python
import math

def get_sqrt_ratio(tick):
    return int(math.sqrt(1.0001 ** tick) * (2**96))
```

### Case 1: Current tick < tickLower (below range)
Position is 100% token0.
```
sqrtA = getSqrtRatio(tickLower)
sqrtB = getSqrtRatio(tickUpper)
liquidity = amount0 * (sqrtA * sqrtB) / (sqrtB - sqrtA)
amount1_needed = 0
```

### Case 2: Current tick >= tickUpper (above range)
Position is 100% token1.
```
sqrtA = getSqrtRatio(tickLower)
sqrtB = getSqrtRatio(tickUpper)
liquidity = amount1 * Q96 / (sqrtB - sqrtA)
amount0_needed = 0
```

### Case 3: In range (tickLower <= current tick < tickUpper)
Both tokens needed.
```
sqrtA = getSqrtRatio(tickLower)
sqrtB = getSqrtRatio(tickUpper)
sqrtC = sqrtPriceX96  # current price from slot0

# From amount0:
liquidity = amount0 * (sqrtC * sqrtB) / (sqrtB - sqrtC)

# Calculate required amount1:
amount1 = liquidity * (sqrtC - sqrtA) / Q96

# Or from amount1:
# liquidity = amount1 * Q96 / (sqrtC - sqrtA)
# amount0 = liquidity * (sqrtB - sqrtC) / (sqrtC * sqrtB / Q96)
```

Where `Q96 = 2^96`.

## Amount Calculation (from liquidity)

Given liquidity L:
```
amount0 = L * (sqrtB - sqrtC) / (sqrtC * sqrtB / Q96)
amount1 = L * (sqrtC - sqrtA) / Q96
```

## Wei Conversion

Always convert human amounts to wei before passing to contracts:
```
amountWei = int(humanAmount * 10^decimals)
```

| Token | Decimals | 1.0 human = wei |
|-------|----------|----------------|
| ETH/WETH | 18 | 1000000000000000000 |
| USDC | 6 | 1000000 |
| WBTC | 8 | 100000000 |
| UNI | 18 | 1000000000000000000 |

## Example: Add 0.1 WETH + USDC to WETH/USDC 0.3% pool

Assumptions:
- Current price: 3200 USDC/ETH
- Range: 2800 - 3600
- Fee: 3000 (tick spacing 60)

Steps:
1. Token ordering: USDC (0x1c7D...) < WETH (0xfFf9...) → token0=USDC, token1=WETH
2. Current tick from slot0 (at price 3200): tick ≈ 80617
3. tickLower (at price 2800): ≈ 79320, round to 79320 (÷60)
4. tickUpper (at price 3600): ≈ 81840, round to 81840 (÷60)
5. Note: since price is in "USDC per WETH" but token0=USDC, the on-chain price is actually inverted (WETH/USDC). Adjust accordingly.
6. amount1Desired = 0.1 * 10^18 = 100000000000000000 (WETH wei)
7. Calculate amount0Desired (USDC) from liquidity math
8. Approve USDC + WETH to NonfungiblePositionManager
9. Call mint()

## Important Notes

- **Token order matters**: token0 < token1 by address. Price is always token1/token0.
- **Precision**: Use integer math for all on-chain values. Python's `int()` truncates.
- **Slippage on testnet**: Set `amount0Min = 0`, `amount1Min = 0` for Sepolia.
- **Deadline**: `int(time.time()) + 600` (10 min from now).
