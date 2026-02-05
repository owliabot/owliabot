---
name: crypto-price
description: Get cryptocurrency prices using CoinGecko API. No API key required.
version: 1.0.0
---

# Crypto Price

Query real-time cryptocurrency prices using the free CoinGecko API.

## Quick Price Check

Use `exec` with curl to fetch prices:

```bash
# Get Bitcoin price in USD
curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"

# Get Ethereum price in multiple currencies
curl -s "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur,btc"

# Get multiple coins at once
curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd"
```

## Response Format

```json
{
  "bitcoin": { "usd": 45000.50 },
  "ethereum": { "usd": 2500.25, "eur": 2300.10, "btc": 0.055 }
}
```

## Common Coin IDs

| Coin | CoinGecko ID |
|------|--------------|
| Bitcoin | `bitcoin` |
| Ethereum | `ethereum` |
| Solana | `solana` |
| BNB | `binancecoin` |
| Polygon | `matic-network` |
| Arbitrum | `arbitrum` |
| Avalanche | `avalanche-2` |

## Supported Currencies

`usd`, `eur`, `gbp`, `jpy`, `cny`, `btc`, `eth`

## Error Handling

- If coin not found: suggest common IDs like 'bitcoin', 'ethereum', 'solana'
- If currency not supported: suggest 'usd', 'eur', 'btc'
- Rate limits: CoinGecko free tier allows 10-30 calls/minute

## Example Workflow

1. User asks: "What's the ETH price?"
2. Run: `curl -s "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"`
3. Parse JSON response
4. Reply: "Ethereum is currently $2,500.25 USD"
