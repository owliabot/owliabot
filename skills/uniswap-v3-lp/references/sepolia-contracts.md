# Sepolia Contract Addresses

Chain ID: **11155111**
RPC: `https://eth-sepolia.g.alchemy.com/v2/demo` (or any Sepolia RPC)
Explorer: `https://sepolia.etherscan.io`

## Uniswap V3 Core

| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |

## Uniswap V3 Periphery

| Contract | Address |
|----------|---------|
| NonfungiblePositionManager | `0x1238536071E1c677A632429e3655c799b22cDA52` |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| QuoterV2 | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| Multicall2 | `0xD7F33bCdb21b359c8ee6F0251d30E94832baAd07` |
| NFTDescriptor | `0x3B5E3c5E595D85fbFBC2a42ECC091e183E76697C` |
| NonfungibleTokenPositionDescriptor | `0x5bE4DAa6982C69aD20A57F1e68cBcA3D37de6207` |
| V3Migrator | `0x729004182cF005CEC8Bd85df140094b6aCbe8b15` |
| ProxyAdmin | `0x0b343475d44EC2b4b8243EBF81dc888BF0A14b36` |

## Other

| Contract | Address |
|----------|---------|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| UniversalRouter | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` |

## Common Tokens (Sepolia)

| Symbol | Decimals | Address |
|--------|----------|---------|
| WETH | 18 | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC | 6 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| UNI | 18 | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` |
| LINK | 18 | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| DAI | 18 | `0x68194a729C2450ad26072b3D33ADaCbcef39D574` |
| WBTC | 8 | `0x29f2D40B0605204364af54EC677bD022dA425d03` |

## Known Pools (Sepolia)

These pools are known to have liquidity on Sepolia for testing:

| Pair | Fee | Pool Address | Notes |
|------|-----|-------------|-------|
| WETH/USDC | 3000 | Query via factory | Most common test pair |
| WETH/UNI | 3000 | Query via factory | |
| USDC/DAI | 500 | Query via factory | Stablecoin pair |

> Always verify pool existence via `factory.getPool()` before attempting to mint.

## Function Selectors (Quick Reference)

| Function | Selector | Contract |
|----------|----------|----------|
| `getPool(address,address,uint24)` | `0x1698ee82` | Factory |
| `slot0()` | `0x3850c7bd` | Pool |
| `mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))` | `0x88316456` | NonfungiblePositionManager |
| `approve(address,uint256)` | `0x095ea7b3` | ERC-20 |
| `balanceOf(address)` | `0x70a08231` | ERC-20 |
| `allowance(address,address)` | `0xdd62ed3e` | ERC-20 |
| `multicall(bytes[])` | `0xac9650d8` | NonfungiblePositionManager |
| `refundETH()` | `0x12210e8a` | NonfungiblePositionManager |
