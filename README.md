# OwliaBot

Self-hosted, crypto-native AI agent with a security-first design.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![English](https://img.shields.io/badge/English-blue)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-lightgrey)](README.zh-CN.md)

## Why OwliaBot?

- **Security first**: private keys never enter the bot process
- **Self-hosted**: run fully on your own machine or server
- **Extensible**: add capabilities through Markdown-based Skills
- **Familiar interfaces**: chat via Telegram or Discord

OwliaBot uses a 3-tier security model:

| Tier | Description | Use Case |
|------|-------------|----------|
| Tier 1 | Companion App (user-confirmed) | Large/irreversible transactions |
| Tier 2 | Session Key (limited, rotatable) | Small automated ops |
| Tier 3 | Smart Contract Wallet | Granular permissions with on-chain limits |

## Features

- Risk-focused AI workflows for crypto-native users and teams
- Signal monitoring across X (Twitter), Telegram, and other sources
- On-chain risk health checks for addresses and positions
- Multi-provider AI model fallback (Anthropic, OpenAI)
- Telegram and Discord channel integrations
- Gateway HTTP server for device pairing and remote tool execution
- System capabilities: `exec`, `web.fetch`, `web.search`
- Memory subsystem with SQLite indexing
- Audit logging with fail-closed design

## Docker Quick Start (Recommended)

The easiest way to run OwliaBot:

```bash
curl -sSL https://raw.githubusercontent.com/owliabot/owliabot/main/install.sh | bash
```

This runs an interactive wizard that:
1. Checks Docker is installed and running
2. Pulls the latest OwliaBot image
3. Runs the interactive onboard configuration
4. Generates `docker-compose.yml`
5. Automatically starts the container

If the container fails to start or channels/providers are misconfigured, run:

```bash
docker exec -it owliabot owliabot doctor
```

To restart manually:

```bash
docker-compose up -d
```

See [Docker Installation Guide](docs/docker-install.md) for details.

---

## Quick Start (Node.js)

### Prerequisites

- Node.js >= 22
- A Telegram Bot token (from @BotFather) or a Discord Bot token
- An AI provider API key (Anthropic, OpenAI) — or use OAuth with Claude subscription

### Option A: Install from npm (Recommended)

```bash
npx owliabot onboard
```

### Option B: Install from source

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
npm install && npm run build
```

> **From source?** Replace `npx owliabot` with `npx tsx src/entry.ts` in all commands below.

### 1. Run interactive setup

```bash
npx owliabot onboard
```

The wizard will guide you through:
- Choosing channels (Discord / Telegram)
- Auto-detecting timezone (editable in config)
- Selecting AI model
- Optional OAuth authentication
- Channel token configuration

Config is saved to `$OWLIABOT_HOME/app.yaml` (default: `~/.owliabot/app.yaml`), secrets to `$OWLIABOT_HOME/secrets.yaml`.

### 2. Start the bot

```bash
npx owliabot start
```

Or with a custom config path:

```bash
npx owliabot start -c /path/to/config.yaml
```

Send a message to your bot — you should get a response!

## Alternative: Manual Configuration

If you prefer manual setup:

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your API keys and tokens
npx owliabot start -c config.yaml
```

## CLI Commands

All commands use `npx owliabot <command>`:

| Command | Description |
|---------|-------------|
| `start` | Start the bot |
| `doctor` | Diagnose startup failures (config/tokens) and guide fixes |
| `onboard` | Interactive setup wizard |
| `auth setup [provider]` | Setup OAuth (anthropic or openai-codex) |
| `auth status [provider]` | Check auth status |
| `auth logout [provider]` | Clear stored credentials |
| `token set <channel>` | Set channel token from env var |
| `pair` | Pair a device with Gateway HTTP |

### Examples

```bash
# Interactive onboarding
npx owliabot onboard

# Diagnose startup issues (config errors / malformed tokens)
npx owliabot doctor

# Start with default config ($OWLIABOT_HOME/app.yaml; default: ~/.owliabot/app.yaml)
npx owliabot start

# Start with custom config
npx owliabot start -c config.yaml

# Setup Claude OAuth
npx owliabot auth setup anthropic

# Check auth status
npx owliabot auth status

# Set Discord token from environment
DISCORD_BOT_TOKEN=xxx npx owliabot token set discord

# Pair a device with gateway
OWLIABOT_GATEWAY_TOKEN=xxx npx owliabot pair --device-id my-device
```

## Gateway HTTP Server

OwliaBot includes an HTTP gateway for device pairing and remote tool execution:

```yaml
# In config.yaml
gateway:
  http:
    port: 8787
    token: ${OWLIABOT_GATEWAY_TOKEN}
    allowlist:
      - "127.0.0.1"
      - "10.0.0.0/8"
```

**Endpoints:**
- `GET /health` — Health check
- `POST /command/system` — System capabilities (web.fetch, web.search, exec)
- `POST /command/tool` — Tool invocation
- `POST /pair/*` — Device pairing flow

## Wallet Integration (Clawlet)

OwliaBot integrates with [Clawlet](https://github.com/owliabot/clawlet), a secure local wallet daemon for executing on-chain operations. This enables the AI agent to query balances and execute transfers while keeping private keys isolated.

### Why Clawlet?

- **Key isolation**: Private keys never enter the OwliaBot process
- **Policy enforcement**: Daily limits, recipient allowlists, token restrictions
- **Audit logging**: All operations logged with agent/session context
- **Confirmation flow**: User approval required for transfers via WriteGate

### Quick Setup

1. **Install and start Clawlet**:

```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh -o /tmp/clawlet-install.sh && \
  sudo bash /tmp/clawlet-install.sh && \
  sudo clawlet start --agent owliabot --daemon && \
  clawlet connect --agent owliabot
```

2. **Reconnect after restart** (wallet daemon or bot restart):

```bash
# Only need connect — no reinstall or sudo required
clawlet connect --agent owliabot
```

> **npm 运行模式**：bot 启动时可自动发起 connect（见下方配置）。
> **Docker 运行模式**：需要在宿主机命令行手动执行 `clawlet connect --agent owliabot`。

3. **Start the OwliaBot gateway**:

```bash
owliabot start
# Or with a specific config: owliabot start -c config.yaml
```

5. **Connect wallet to the running bot**:

```bash
# With token as argument
owliabot wallet connect --token clwt_xxxxx

# Or interactive mode (auto-detects daemon, prompts for token)
owliabot wallet connect
```

The command tests the connection (fetches address and balance) and registers wallet tools in the gateway. Wallet configuration is stored **in memory only** — it is never written to the config file. If the gateway restarts, run `wallet connect` again.

To disconnect:

```bash
owliabot wallet disconnect
```

See [Clawlet documentation](https://github.com/owliabot/clawlet) for advanced configuration (Unix socket mode, policy rules, systemd/launchd setup).

### Available Wallet Tools

| Tool | Scope | Description |
|------|-------|-------------|
| `wallet_balance` | read | Query ETH + ERC-20 token balances |
| `wallet_transfer` | trade | Execute transfers (requires confirmation) |

### Supported Chains

| Chain ID | Network |
|----------|---------|
| 1 | Ethereum Mainnet |
| 11155111 | Ethereum Sepolia (testnet) |
| 8453 | Base |
| 10 | Optimism |
| 42161 | Arbitrum One |

### Example Interactions

```
User: What's my wallet balance?
Owlia: Your wallet (0x1234...5678) on Base:
       ETH: 0.52
       Tokens: USDC: 150.00, WETH: 0.1

User: Send 0.1 ETH to 0xRecipient...
Owlia: Transfer 0.1 ETH to 0xRecipient... on chain 8453. Confirm? [y/n]
User: y
Owlia: ✓ Successfully transferred 0.1 ETH. TX: 0xabc123...
```

## Skills System

OwliaBot uses a Markdown-based Skills system. Each skill is a `SKILL.md` file with YAML frontmatter containing instructions for the LLM.

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `weather` | Weather queries via wttr.in |
| `github` | GitHub CLI operations |
| `web-search` | Web search and fetch guidance |

### Creating Custom Skills

1. Create a directory in `~/.owliabot/skills/`:

```bash
mkdir -p ~/.owliabot/skills/my-skill
```

2. Create `SKILL.md` with frontmatter:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
---

# My Skill

Instructions for the LLM...
```

Skills are loaded from three directories (later overrides earlier):
- `<owliabot>/skills/` (builtin)
- `~/.owliabot/skills/` (user)
- `<workspace>/skills/` (project)

See [Skill System Design](docs/design/skill-system.md) for details.

## Configuration Reference

Key sections in your config file:

| Section | Description |
|---------|-------------|
| `providers` | AI providers with priority-based fallback |
| `telegram` | Telegram bot token and allowList |
| `discord` | Discord bot token, guild settings, mention rules |
| `workspace` | Path to workspace data (default `./workspace`) |
| `gateway.http` | HTTP server for device pairing |
| `notifications` | Proactive message target |
| `heartbeat` | Cron-based scheduled tasks |
| `system` | System capabilities (exec, web) policy |

See [`config.example.yaml`](./config.example.yaml) for all options.

## Development

```bash
# Dev mode with hot reload
npm run dev -- start -c config.yaml

# Type check
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Build for production
npm run build
npm run start -- start -c config.yaml
```

## Project Structure

```
src/
├── entry.ts           # CLI entry point
├── config/            # Config schema and loader
├── channels/          # Telegram / Discord integrations
├── agent/             # Agent runtime, sessions, tools
├── gateway/           # Message gateway
├── gateway/http/      # HTTP server for device pairing
├── security/          # WriteGate, Tier policy, audit
├── memory/            # Memory search and indexing
├── workspace/         # Workspace loader
└── skills/            # Skills system
```

## Documentation

- [Setup & Verification Guide](docs/setup-verify.md)
- [Gateway HTTP Design](docs/architecture/gateway-design.md)
- [System Capabilities](docs/architecture/system-capability.md)
- [Skill System Design](docs/design/skill-system.md)
- [Tier Policy & Security](docs/design/tier-policy.md)
- [Audit Strategy](docs/design/audit-strategy.md)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot fails on startup | Validate config YAML syntax and required fields |
| "Node.js version" error | Upgrade to Node.js >= 22 |
| Bot doesn't respond | Check allowList includes your user ID |
| OAuth expired | Run `npx owliabot auth setup` again |
| Discord bot silent in guild | Ensure `requireMentionInGuild` settings and channel allowlist. See [Discord Setup Guide](docs/discord-setup.md) |
| Discord bot not receiving messages | Enable MESSAGE CONTENT INTENT in Discord Developer Portal. See [Discord Setup Guide](docs/discord-setup.md) |
| Discord bot can't reply in threads | Enable "Send Messages in Threads" permission. See [Discord Setup Guide](docs/discord-setup.md) |

## License

MIT
