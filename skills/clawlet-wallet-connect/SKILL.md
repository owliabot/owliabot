---
name: clawlet-wallet-connect
description: Guide the user through installing Clawlet wallet daemon and connecting it to OwliaBot.
version: 2.1.0
---

# Wallet Connect (Clawlet)

Help the user install and connect the Clawlet wallet daemon to OwliaBot.

## Step 1 — Detect Environment

**Run silently before talking to the user:**

```bash
which clawlet 2>/dev/null && clawlet status 2>/dev/null; ps aux | grep -v grep | grep -E "clawlet|owliabot" 2>/dev/null
```

## Step 2 — Execute (based on detection)

Based on Step 1 results, **compose only the commands needed**:

### Case A: Not installed

Full chain — install + start + connect:

```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh -o /tmp/clawlet-install.sh && sudo bash /tmp/clawlet-install.sh --isolated && sudo -H -u clawlet /usr/local/bin/clawlet start --agent owliabot --daemon && clawlet connect --agent owliabot
```

> Creating a new wallet will show a mnemonic — **remind the user to save it**, it won't be shown again.

### Case B: Installed but not running

Start + connect only:

```bash
sudo -H -u clawlet /usr/local/bin/clawlet start --agent owliabot --daemon && clawlet connect --agent owliabot
```

### Case C: Running but not connected

Connect only:

```bash
clawlet connect --agent owliabot
```

### Case D: OwliaBot not running

Warn the user to start OwliaBot first — connect requires a running OwliaBot instance.

## Step 3 — Verify

```bash
clawlet status
```

Expected:

```
✓ Connected to OwliaBot
  Address: 0x1234...5678
  Balance: 0.52 ETH
  Tools:   wallet_balance, wallet_transfer, wallet_send_tx
```

## Reconnect After Restart

Wallet config is in-memory. After OwliaBot restarts: `clawlet connect --agent owliabot`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `clawlet: command not found` | Re-run install script or check PATH |
| Health check fails | `sudo -H -u clawlet clawlet start --daemon` |
| `gateway.http is not configured` | Add `gateway.http` to `app.yaml`, restart OwliaBot |
| Docker can't reach Clawlet | Clawlet must listen on `0.0.0.0:9100` or use host networking |

## Supported Chains

Base (8453, default) · Ethereum (1) · Optimism (10) · Arbitrum (42161) · Sepolia (11155111)
