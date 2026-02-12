---
name: clawlet-wallet-connect
description: Guide the user through installing Clawlet wallet daemon and connecting it to OwliaBot.
version: 2.0.0
---

# Wallet Connect (Clawlet)

Help the user install and connect the Clawlet wallet daemon to OwliaBot.

## Step 1 — Detect Environment

**Run silently before talking to the user:**

```bash
which clawlet 2>/dev/null && clawlet status 2>/dev/null; ps aux | grep -v grep | grep -E "clawlet|owliabot" 2>/dev/null
```

Based on results:

| Clawlet | OwliaBot | Action |
|---------|----------|--------|
| Not installed | Running | → Step 2 (install + connect) |
| Installed, not running | Running | → Step 2 (script detects existing install, starts + connects) |
| Installed + running | Running | → `clawlet connect --agent owliabot` then Step 3 |
| Any | Not running | Warn user to start OwliaBot first |

## Step 2 — Install, Start & Connect

One command does everything:

```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh -o /tmp/clawlet-install.sh && sudo bash /tmp/clawlet-install.sh --isolated && sudo -H -u clawlet /usr/local/bin/clawlet start --agent owliabot --daemon && clawlet connect --agent owliabot
```

The script will interactively prompt for:
1. Wallet password (encrypts private key)
2. Create new wallet or import existing mnemonic

After completion, expect:

```
✓ Connected to OwliaBot
  Address: 0x1234...5678
  Balance: 0.52 ETH
  Tools:   wallet_balance, wallet_transfer, wallet_send_tx
```

> If creating a new wallet, **remind the user to save the mnemonic** — it won't be shown again.

## Step 3 — Verify

```bash
clawlet status
```

If connect failed, re-run: `clawlet connect --agent owliabot` (no sudo needed).

## Reconnect After Restart

Wallet config is in-memory. After OwliaBot restarts:

```bash
clawlet connect --agent owliabot
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `clawlet: command not found` | Re-run install script or check PATH |
| Health check fails | `sudo -H -u clawlet clawlet start --daemon` |
| `gateway.http is not configured` | Add `gateway.http` to `app.yaml`, restart OwliaBot |
| Docker can't reach Clawlet | Clawlet must listen on `0.0.0.0:9100` or use host networking |

## Supported Chains

Base (8453, default) · Ethereum (1) · Optimism (10) · Arbitrum (42161) · Sepolia (11155111)
