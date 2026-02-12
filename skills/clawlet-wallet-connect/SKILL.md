---
name: clawlet-wallet-connect
description: Guide the user through installing Clawlet wallet daemon and connecting it to OwliaBot.
version: 1.0.0
---

# Wallet Connect (Clawlet)

Guide the user step-by-step to install the Clawlet wallet daemon and connect it to OwliaBot.

## Step 1 — Check Prerequisites

Before starting, confirm:
- OwliaBot is already running (`owliabot start` or Docker container is up)
- Gateway HTTP is enabled in `app.yaml` (section `gateway.http`)

If the user hasn't started OwliaBot yet, tell them to do that first.

## Step 2 — Install Clawlet

Clawlet is a secure local wallet daemon that keeps private keys isolated from OwliaBot.

```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh | sudo bash -s -- --isolated
```

This creates a dedicated system user for key isolation.

After install, verify:

```bash
clawlet --version
```

## Step 3 — Start Clawlet

`clawlet start` initializes the wallet and starts the HTTP server:

```bash
# Isolated mode (recommended)
sudo -H -u clawlet clawlet start --daemon

# Or under current user
clawlet start
```

This will:
1. Initialize a new wallet (if not already initialized)
2. Start the HTTP server on `http://127.0.0.1:9100`

Then generate an auth token separately:

```bash
# Isolated mode
sudo -H -u clawlet clawlet auth grant --scope read,trade --label owliabot

# Or under current user
clawlet auth grant --scope read,trade --label owliabot
```

The token (`clwt_xxxxx`) is printed to stdout — **save it** for the next step.

## Step 4 — Connect to OwliaBot

With the token from the `auth grant` step, run the connect command matching your OwliaBot setup:

### Docker mode (recommended)

```bash
docker exec -it owliabot owliabot wallet connect --token clwt_xxxxx

# Or interactive (auto-detects daemon, prompts for token)
docker exec -it owliabot owliabot wallet connect
```

### npm mode (Node.js)

```bash
npx tsx src/entry.ts wallet connect --token clwt_xxxxx

# Or interactive
npx tsx src/entry.ts wallet connect
```

On success you'll see:

```
Wallet connected successfully!
  Address: 0x1234...5678
  Balance: 0.52 ETH
  Scope:   trade
  Tools:   wallet_balance, wallet_transfer
```

## Important Notes

- Wallet config is stored **in memory only**. If the gateway restarts, run `wallet connect` again.
- To disconnect: `owliabot wallet disconnect`
- Private keys never enter the OwliaBot process — all signing happens inside Clawlet.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `clawlet: command not found` | Re-run the install script or check your PATH |
| Health check fails | Make sure `clawlet start` is running |
| `Invalid token format` | Token must start with `clwt_` — re-run `clawlet auth grant --scope read,trade --label owliabot` |
| `gateway.http is not configured` | Add `gateway.http` section to `app.yaml` and restart OwliaBot |
| Docker can't reach Clawlet | Clawlet must listen on `0.0.0.0:9100` (not just 127.0.0.1) or use host networking |

## Supported Chains

| Chain ID | Network |
|----------|---------|
| 1 | Ethereum Mainnet |
| 8453 | Base (default) |
| 10 | Optimism |
| 42161 | Arbitrum One |
| 11155111 | Sepolia (testnet) |
