---
name: clawlet-wallet-connect
description: Guide the user through installing Clawlet wallet daemon and connecting it to OwliaBot.
version: 2.3.0
---

# Wallet Connect (Clawlet)

Help the user install and connect the Clawlet wallet daemon to OwliaBot.

## Step 1 — Detect Environment

**Run silently before talking to the user:**

```bash
command -v clawlet >/dev/null 2>&1 && echo "CLAWLET_INSTALLED=yes" || echo "CLAWLET_INSTALLED=no"
ps aux | grep -v grep | grep clawlet >/dev/null 2>&1 && echo "CLAWLET_RUNNING=yes" || echo "CLAWLET_RUNNING=no"
ps aux | grep -v grep | grep -E "owliabot" >/dev/null 2>&1 && echo "OWLIABOT_RUNNING=yes" || echo "OWLIABOT_RUNNING=no"
```

## Step 2 — Execute (check in this order)

**Priority order — check top to bottom, take the first match:**

### 1. OwliaBot not running?

If `OWLIABOT_RUNNING=no` → **Stop.** Tell user to start OwliaBot first.

### 2. Clawlet not installed?

If `CLAWLET_INSTALLED=no` → Full chain (install + start + connect):

```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh -o /tmp/clawlet-install.sh && sudo bash /tmp/clawlet-install.sh --isolated && sudo -H -u clawlet clawlet start --agent owliabot --daemon && clawlet connect --agent owliabot
```

> Creating a new wallet will show a mnemonic — **remind the user to save it**, it won't be shown again.

### 3. Installed but not running?

If `CLAWLET_INSTALLED=yes` and `CLAWLET_RUNNING=no` → Start + connect:

```bash
sudo -H -u clawlet clawlet start --agent owliabot --daemon && clawlet connect --agent owliabot
```

### 4. Running?

If `CLAWLET_RUNNING=yes` → Connect (idempotent, safe to re-run):

```bash
clawlet connect --agent owliabot
```

## Step 3 — Verify

```bash
clawlet connect --agent owliabot
```

Success output:

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
| Daemon not running | `sudo -H -u clawlet clawlet start --agent owliabot --daemon` |
| `gateway.http is not configured` | Add `gateway.http` to `app.yaml`, restart OwliaBot |
| Docker can't reach Clawlet | Clawlet must listen on `0.0.0.0:9100` or use host networking |

## Supported Chains

Base (8453, default) · Ethereum (1) · Optimism (10) · Arbitrum (42161) · Sepolia (11155111)
