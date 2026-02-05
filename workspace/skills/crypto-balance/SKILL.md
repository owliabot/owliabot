---
name: crypto-balance
description: Check native token balances on EVM chains using public RPC endpoints.
version: 1.0.0
---

# Crypto Balance

Query native token balances (ETH, MATIC, etc.) on EVM-compatible chains.

## Prerequisites

For reliable queries, set `ALCHEMY_API_KEY` in your environment. Without it, use public RPCs (may be rate-limited).

## Quick Balance Check

Use `exec` with curl to query via JSON-RPC:

```bash
# Check ETH balance on Ethereum mainnet (public RPC)
curl -s -X POST https://eth.llamarpc.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'
```

### With Alchemy (recommended)

```bash
# Ethereum
curl -s -X POST "https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'

# Polygon
curl -s -X POST "https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'

# Arbitrum
curl -s -X POST "https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'

# Base
curl -s -X POST "https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'
```

## Public RPC Endpoints (No API Key)

| Chain | RPC URL |
|-------|---------|
| Ethereum | `https://eth.llamarpc.com` |
| Polygon | `https://polygon-rpc.com` |
| Arbitrum | `https://arb1.arbitrum.io/rpc` |
| Base | `https://mainnet.base.org` |

## Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x1bc16d674ec80000"  // Balance in wei (hex)
}
```

## Converting Wei to ETH

The result is in wei (hex). To convert:

```bash
# Using Python
python3 -c "print(int('0x1bc16d674ec80000', 16) / 1e18)"
# Output: 2.0 (ETH)
```

## Native Token Symbols

| Chain | Symbol |
|-------|--------|
| Ethereum | ETH |
| Polygon | MATIC |
| Arbitrum | ETH |
| Base | ETH |

## Address Validation

Valid EVM address format: `0x` followed by 40 hex characters
- ✅ `0x742d35Cc6634C0532925a3b844Bc9e7595f85a3d`
- ❌ `742d35Cc6634C0532925a3b844Bc9e7595f85a3d` (missing 0x)
- ❌ `0x742d35Cc` (too short)

## Example Workflow

1. User asks: "What's the ETH balance of 0x742d35Cc6634C0532925a3b844Bc9e7595f85a3d?"
2. Validate address format
3. Run curl command against Ethereum RPC
4. Convert hex result to decimal, divide by 1e18
5. Reply: "Address 0x742d...5a3d has 2.5 ETH on Ethereum mainnet"
