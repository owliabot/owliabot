# OwliaBot

Crypto-native, security-focused AI agent.

[![English](https://img.shields.io/badge/English-blue)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-lightgrey)](README.zh-CN.md)

## OwliaBot Introduction

OwliaBot is an **open-source, community-friendly** AI agent for crypto-native.

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

## Requirements

- Node.js >= 22.0.0
- npm >= 10 (recommended)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure the Bot

1. Copy the example config:

```bash
cp config.example.yaml config.yaml
```

2. Fill in the values in `config.yaml` (providers, tokens, and notifications).
3. Set required environment variables (examples):

```bash
export ANTHROPIC_API_KEY="your_anthropic_key"
export OPENAI_API_KEY="your_openai_key"
export TELEGRAM_BOT_TOKEN="your_telegram_token"
export DISCORD_BOT_TOKEN="your_discord_token"
```

### 3. (Optional) OAuth with Claude

If you want to use Claude subscription OAuth instead of API keys:

```bash
npm run dev -- auth setup
```

Then set the Anthropic provider in `config.yaml` like this:

```yaml
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: oauth
    priority: 1
```

### 4. Run the Bot

Development mode:

```bash
npm run dev -- start -c config.yaml
```

Production-like mode:

```bash
npm run build
npm run start -- start -c config.yaml
```

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

## Configuration Notes

Key sections in `config.yaml`:

- `providers`: AI providers in priority order.
- `telegram` / `discord`: channel tokens and optional allow lists.
- `notifications.channel`: where proactive messages go (e.g. `telegram:883499266`).
- `workspace`: path to workspace data (default `./workspace`).
- `heartbeat`: cron-based heartbeat configuration.

## Project Structure

- `src/entry.ts`: CLI entry point (`owliabot`).
- `src/config/*`: config schema, types, and loader.
- `src/channels/*`: Telegram / Discord integrations.
- `src/agent/*`: agent runtime, sessions, and tools.
- `src/workspace/*`: workspace loading and memory search.
- `config.example.yaml`: configuration template.

## Troubleshooting

- If the bot fails on startup, validate `config.yaml` first.
- Ensure environment variables are visible in the current shell session.
- Node.js version must be >= 22.
