# OwliaBot

Self-hosted, crypto-native AI agent with a security-first design.

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

## Quick Start

### Prerequisites

- Node.js >= 22
- A Telegram Bot token (from @BotFather) or a Discord Bot token
- An AI provider API key (Anthropic, OpenAI) — or use OAuth with Claude subscription

### 1. Clone and install

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
npm install
```

### 2. Run interactive setup (recommended)

```bash
npx tsx src/entry.ts onboard
```

The wizard will guide you through:
- Choosing channels (Discord / Telegram)
- Setting workspace path
- Selecting AI model
- Optional OAuth authentication
- Channel token configuration

Config is saved to `~/.owlia_dev/app.yaml`, secrets to `~/.owlia_dev/secrets.yaml`.

### 3. Start the bot

```bash
npx tsx src/entry.ts start
```

Or with a custom config path:

```bash
npx tsx src/entry.ts start -c /path/to/config.yaml
```

Send a message to your bot — you should get a response!

## Alternative: Manual Configuration

If you prefer manual setup:

```bash
cp config.example.yaml config.yaml
# Edit config.yaml with your API keys and tokens
npx tsx src/entry.ts start -c config.yaml
```

## CLI Commands

All commands use `npx tsx src/entry.ts <command>`:

| Command | Description |
|---------|-------------|
| `start` | Start the bot |
| `onboard` | Interactive setup wizard |
| `auth setup [provider]` | Setup OAuth (anthropic or openai-codex) |
| `auth status [provider]` | Check auth status |
| `auth logout [provider]` | Clear stored credentials |
| `token set <channel>` | Set channel token from env var |
| `pair` | Pair a device with Gateway HTTP |

### Examples

```bash
# Interactive onboarding
npx tsx src/entry.ts onboard

# Start with default config (~/.owlia_dev/app.yaml)
npx tsx src/entry.ts start

# Start with custom config
npx tsx src/entry.ts start -c config.yaml

# Setup Claude OAuth
npx tsx src/entry.ts auth setup anthropic

# Check auth status
npx tsx src/entry.ts auth status

# Set Discord token from environment
DISCORD_BOT_TOKEN=xxx npx tsx src/entry.ts token set discord

# Pair a device with gateway
OWLIABOT_GATEWAY_TOKEN=xxx npx tsx src/entry.ts pair --device-id my-device
```

## Gateway HTTP Server

OwliaBot includes an HTTP gateway for device pairing and remote tool execution:

```yaml
# In config.yaml
gateway:
  http:
    port: 8787
    token: ${GATEWAY_TOKEN}
    allowlist:
      - "127.0.0.1"
      - "10.0.0.0/8"
```

**Endpoints:**
- `GET /health` — Health check
- `POST /command/system` — System capabilities (web.fetch, web.search, exec)
- `POST /command/tool` — Tool invocation
- `POST /pair/*` — Device pairing flow

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
├── gateway-http/      # HTTP server for device pairing
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
| OAuth expired | Run `npx tsx src/entry.ts auth setup` again |
| Discord bot silent in guild | Ensure `requireMentionInGuild` settings and channel allowlist |

## License

MIT
