# OwliaBot

Self-hosted, crypto-native AI agent with a security-first design.

[![English](https://img.shields.io/badge/English-blue)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-lightgrey)](README.zh-CN.md)

## Why OwliaBot?

- Security first: private keys never enter the bot process.
- Self-hosted: run fully on your own machine or server.
- Extensible: add capabilities through JavaScript Skills.
- Familiar interfaces: chat via Telegram or Discord.

OwliaBot uses a 3-tier security model:

- Tier 1: Companion App (user-confirmed transactions)
- Tier 2: Session Key (small automated ops)
- Tier 3: Smart Contract Wallet (large automated ops with granular permissions)

## Features

- Risk-focused AI workflows for crypto-native users and teams.
- Signal monitoring across X (Twitter), Telegram, and other sources.
- On-chain risk health checks for addresses and positions.
- Ongoing monitoring for lending, LP, and other DeFi risk signals.
- Clear, natural-language explanations of complex DeFi risk metrics.
- Multi-provider AI model fallback (Anthropic, OpenAI).
- Telegram and Discord channel integrations.
- YAML-based configuration with environment variable support.
- OAuth flow for Claude subscription authentication.
- Workspace loading and cron-based heartbeat support.

## Quick Start

### Prerequisites

- Node.js >= 22
- A Telegram Bot token (from @BotFather) or a Discord Bot token
- An AI provider API key (Anthropic, OpenAI, etc.)

### 1. Install dependencies

```bash
npm install
```

### 2. Copy config template

```bash
cp config.example.yaml config.yaml
```

### 3. Minimal configuration

Edit `config.yaml`:

```yaml
providers:
  - id: claude
    model: claude-sonnet-4-5
    apiKey: "your-anthropic-api-key"

telegram:
  token: "your-telegram-bot-token"
  allowList:
    - "your-telegram-user-id"

workspace: ./workspace
```

You can also configure Discord instead of Telegram.

### 4. Run the bot

```bash
npm run dev -- start -c config.yaml
```

Send a message to your bot. You should get a response.

## Built-in Skills

OwliaBot includes built-in skills to help you get started:

- `crypto-price`: query prices from CoinGecko (no API key required)
- `crypto-balance`: query wallet balances across chains (requires `ALCHEMY_API_KEY`)

Example prompts:

- "What's the current price of bitcoin?"
- "Check balance of 0x... on ethereum"

To enable `crypto-balance`, set:

```bash
export ALCHEMY_API_KEY="your-key-here"
```

## Configuration Notes

Key sections in `config.yaml`:

- `providers`: one or more AI providers, with optional `priority`
- `telegram` / `discord`: channel tokens and optional `allowList`
- `workspace`: path to workspace data (default `./workspace`)
- `skills.enabled` and `skills.directory`: skills system toggle and path
- `notifications.channel`: proactive message target (for example `telegram:883499266`)
- `heartbeat`: cron-based scheduled tasks
- `session`: DM conversation scope
  - **Note:** DMs are treated as a single “main” conversation bucket (not per-sender). This is intended for single-user allowlist setups.
  - `session.mainKey`: the DM bucket name (default `main`)
  - `session.scope`: `per-agent` (default) or `global`
- `group.activation`: group chat activation mode
  - `mention` (default): only respond when explicitly mentioned (`ctx.mentioned`) or when the channel/group is allowlisted
    - Discord: `ctx.mentioned` is true when you mention the bot (@bot)
    - Telegram groups: `ctx.mentioned` is true when you reply to the bot, @botusername, or use a /command (optionally /command@bot)
  - `always`: respond to all messages in group chats (consider allowlists to avoid spam)

Common environment variables:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `ALCHEMY_API_KEY`

### (Optional) Claude OAuth

If you want to use Claude subscription OAuth instead of API keys:

```bash
npm run dev -- auth setup
```

Then set the Anthropic provider in `config.yaml`:

```yaml
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: oauth
    priority: 1
```

## Project Structure

- `src/entry.ts`: CLI entry point (`owliabot`)
- `src/config/*`: config schema, types, and loader
- `src/channels/*`: Telegram / Discord integrations
- `src/agent/*`: agent runtime, sessions, and tools
- `src/workspace/*`: workspace loading and memory search
- `src/memory/*`: memory search providers, indexing, and configuration
- `config.example.yaml`: configuration template

## Documentation Map (Source)

These repo docs are the canonical reference:

- `docs/src/content/docs/getting-started/introduction.md`
- `docs/src/content/docs/getting-started/quick-start.md`
- `docs/src/content/docs/reference/configuration.md`
- `docs/src/content/docs/architecture/overview.md`
- `docs/src/content/docs/architecture/security.md`
- `docs/src/content/docs/skills/builtin-skills.md`
- `docs/src/content/docs/skills/creating-skills.md`

## Architecture Notes (Repo)

- `docs/architecture/gateway-design.md`
- `docs/architecture/gateway-functional.md`
- `docs/architecture/gateway-technical.md`
- `docs/architecture/playwright-mcp.md`
- `docs/architecture/system-capability.md`

## Common Commands

```bash
npm run dev -- start -c config.yaml   # run in dev/watch mode
npm run build                         # compile TypeScript
npm run start -- start -c config.yaml # run compiled output
npm run lint                          # run ESLint
npm run typecheck                     # TypeScript type check
npm run test                          # run tests once
npm run test:watch                    # run tests in watch mode
```

## Troubleshooting

- If the bot fails on startup, validate `config.yaml` first.
- Ensure environment variables are visible in the current shell session.
- Node.js version must be >= 22.
