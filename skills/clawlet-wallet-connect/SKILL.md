---
name: clawlet-wallet-connect
description: Guide the user through installing Clawlet wallet daemon and connecting it to OwliaBot.
version: 1.1.0
---

# Wallet Connect (Clawlet)

Guide the user step-by-step to install the Clawlet wallet daemon and connect it to OwliaBot.

**Before starting any user interaction**, run the detection steps (Step 1 & 2) silently to gather context. Then present the user with a clear, tailored guide based on the detected environment.

## Step 1 — Detect Clawlet Status

Use the `exec` tool to check whether Clawlet is installed and running.

### 1a. Check if Clawlet binary is installed

```bash
which clawlet
```

- **Found** → binary is installed, note the path.
- **Not found** → Clawlet is not installed. The user needs to install it (see Step 3).

### 1b. Check if Clawlet daemon is running

```bash
ps aux | grep -v grep | grep clawlet
```

Interpret the results:

| Installed | Running | Next Action |
|-----------|---------|-------------|
| Yes | Yes | Skip to Step 4 (connect) |
| Yes | No | Guide user to run install script (Step 3) — it detects existing install and starts the daemon |
| No | — | Guide user to run install script (Step 3) |

Tell the user what you detected, e.g.:
- "Clawlet is installed and running — let's connect it."
- "Clawlet is installed but not running — let's run the setup script to start it."
- "Clawlet is not installed yet — let me walk you through the setup."

## Step 2 — Detect OwliaBot Running Mode

Use the `exec` tool to determine whether OwliaBot is running via Docker or npm (Node.js).

### Detection logic

Run these checks in order:

```bash
# Check if owliabot is running as a Docker container
docker ps --filter "name=owliabot" --format "{{.Names}}" 2>/dev/null
```

- If the output contains `owliabot` → **Docker mode**.
- If the command fails or returns empty:

```bash
# Check if owliabot node process is running
ps aux | grep -v grep | grep -E "tsx.*entry|node.*owliabot"
```

- If a matching process is found → **npm mode**.
- If neither is detected → OwliaBot may not be running. Warn the user and ask them to start it first.

Tell the user the detected mode, e.g.:
- "OwliaBot is running in Docker mode."
- "OwliaBot is running in npm (Node.js) mode."

**Remember the detected mode** — it determines the commands used in later steps.

## Step 3 — Install & Start Clawlet

Clawlet is a secure local wallet daemon that keeps private keys isolated from OwliaBot.

The install script handles everything — install, init, and start — in one command. If Clawlet is already installed, it detects the existing installation and starts the daemon.

Tell the user to run this single command (downloads, installs, and starts the daemon):

```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh -o /tmp/clawlet-install.sh && sudo bash /tmp/clawlet-install.sh --isolated && sudo -H -u clawlet "$(which clawlet)" start --agent owliabot --daemon
```

> **Why download first?** The script is saved to `/tmp/` before execution — this avoids piping directly to `sudo bash`, which is safer and allows inspection before running.
>
> **Note:** `$(which clawlet)` dynamically resolves the binary path, so it works regardless of install prefix.

After the script finishes, verify with the `exec` tool:

```bash
clawlet --version
```

The install + start sequence will output useful commands at the end:

```
Useful commands:

  # View logs:
  sudo tail -f /home/clawlet/.clawlet/clawlet.log   # Linux
  sudo tail -f /var/clawlet/.clawlet/clawlet.log     # macOS

  # Stop daemon:
  sudo -H -u clawlet clawlet stop

  # Clear sudo cache (security best practice):
  sudo -k
```

The script walks through an interactive flow:

#### Set wallet password

The user will be prompted to enter and confirm a password. This password encrypts the private key AND is used to authorize token grants later.

Password requirements:
- At least 8 characters
- At least 1 uppercase letter, 1 lowercase letter, 1 digit, 1 symbol

#### Create or import wallet

If no existing keystore is found, the user chooses:
- **1) Create new wallet** — generates a BIP-39 mnemonic
- **2) Import existing mnemonic** — enter an existing phrase

If "Create new wallet" is chosen, a 24-word mnemonic is shown on a secure alternate screen. **Remind the user to write it down immediately** — it will NOT be shown again.

If a keystore already exists, the user just enters the existing password to unlock.

#### Token output

After init, the command prints a token like:

```
🎫 Token for "owliabot" (scope: read,trade, expires: 2027-02-11)
   clwt_xxxxx
```

**Ask the user to copy and share the token** — it's needed in the next step.

## Step 4 — Connect to OwliaBot

Based on the running mode detected in Step 2, connect Clawlet to OwliaBot.

### Option A: Use `clawlet connect` (preferred)

The `clawlet connect` command handles the full connection flow — it detects OwliaBot, generates a token, and connects automatically. The user just needs to enter their wallet password when prompted.

If the `exec` tool is available, run it directly:

```bash
clawlet connect --agent owliabot
```

This will:
1. Detect the running OwliaBot instance (gateway HTTP endpoint)
2. Prompt the user for their wallet password
3. Generate an auth token and send it to OwliaBot automatically

If the `exec` tool is not available, provide the command above for the user to run in their terminal.

### Option B: Manual `wallet connect` (fallback)

If `clawlet connect` is not available or fails, fall back to the manual flow using the token from Step 3.

**Docker mode:**
```bash
docker exec -it owliabot owliabot wallet connect --token clwt_xxxxx
```

**npm mode:**
```bash
npx owliabot wallet connect --token clwt_xxxxx
```

### Success output

On success the user should see:

```
Wallet connected successfully!
  Address: 0x1234...5678
  Balance: 0.52 ETH
  Scope:   trade
  Tools:   wallet_balance, wallet_transfer, wallet_send_tx
```

Confirm the connection by showing the address and available tools.

## Important Notes

- Wallet config is stored **in memory only**. If the gateway restarts, run `wallet connect` again.
- To disconnect: `owliabot wallet disconnect`
- Private keys never enter the OwliaBot process — all signing happens inside Clawlet.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `clawlet: command not found` | Re-run the install script or check your PATH |
| Health check fails | Make sure `clawlet start` is running |
| `Invalid token format` | Token must start with `clwt_` — re-run `clawlet start --agent owliabot` |
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
