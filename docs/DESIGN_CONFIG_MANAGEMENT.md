# Configuration Management Design

> Docker-friendly configuration strategy for owliabot-core
> Created: 2026-02-05

## Goals

1. **Docker-friendly**: Easy to deploy and configure via Docker Compose
2. **Secure**: Sensitive tokens via env vars or secrets
3. **Runtime updates**: Change config without container restart (where possible)
4. **User-friendly**: Bot commands for common config changes
5. **Validated**: Strict schema validation, clear error messages

---

## 1. Configuration Sources (Priority Order)

```
1. Environment Variables     (highest priority, for tokens/secrets)
2. Config File              (main configuration)
3. Runtime State            (session-level overrides)
4. Defaults                 (built-in safe defaults)
```

### 1.1 Environment Variables

Sensitive values and Docker-specific overrides:

```bash
# Tokens (required)
DISCORD_BOT_TOKEN=xxx
TELEGRAM_BOT_TOKEN=xxx

# LLM Providers
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx
OPENROUTER_API_KEY=xxx

# Paths (Docker-friendly)
OWLIABOT_CONFIG_PATH=/app/config/config.yaml
OWLIABOT_WORKSPACE=/app/workspace
OWLIABOT_SESSIONS_DIR=/app/sessions

# Optional overrides
OWLIABOT_LOG_LEVEL=info
OWLIABOT_TIMEZONE=UTC
```

### 1.2 Config File

Location priority:
1. `$OWLIABOT_CONFIG_PATH` (env override)
2. `/app/config/config.yaml` (Docker default)
3. `~/.owliabot/config.yaml` (local install)
4. `./config.yaml` (development)

Format: **YAML** (human-friendly, supports comments)

### 1.3 Runtime State

Stored in session metadata, survives restarts:
- Per-channel activation mode (`/activation always|mention`)
- Per-session model override (`/model`)
- Temporary allowlist additions (via pairing)

---

## 2. Docker Deployment Pattern

### 2.1 Recommended docker-compose.yaml

```yaml
version: '3.8'

services:
  owliabot:
    image: ghcr.io/owliabot/owliabot:latest
    environment:
      # Required: Bot tokens (use secrets in production)
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      
      # LLM Provider (pick one or more)
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      # - OPENAI_API_KEY=${OPENAI_API_KEY}
      
      # Optional settings
      - OWLIABOT_LOG_LEVEL=info
      - TZ=Asia/Shanghai
    
    volumes:
      # Config file (editable)
      - ./config:/app/config
      
      # Persistent data
      - ./workspace:/app/workspace
      - ./sessions:/app/sessions
      
      # Auth tokens (OAuth etc)
      - ./auth:/home/owliabot/.owliabot/auth
    
    restart: unless-stopped
```

### 2.2 Minimal config/config.yaml

```yaml
# owliabot-core configuration
# Tokens are in environment variables for security

discord:
  enabled: true
  dm:
    policy: pairing  # pairing | allowlist | open
  groupPolicy: allowlist
  guilds:
    "*":
      requireMention: true

telegram:
  enabled: true
  dmPolicy: pairing
  groupPolicy: allowlist
  groups:
    "*":
      requireMention: true

# Default provider (env vars provide the API key)
providers:
  - id: anthropic
    model: claude-sonnet-4-20250514
```

### 2.3 Full config example

```yaml
# Complete configuration example

# Agent identity
agent:
  id: main
  name: Owlia
  timezone: Asia/Shanghai

# LLM Providers (API keys via env vars)
providers:
  - id: anthropic
    model: claude-sonnet-4-20250514
  - id: openai
    model: gpt-4o
    # fallback when anthropic fails

# Discord configuration
discord:
  enabled: true
  
  # DM settings
  dm:
    enabled: true
    policy: pairing  # pairing | allowlist | open | disabled
    allowFrom: []    # populated by pairing or manually
    
  # Group settings  
  groupPolicy: allowlist  # open | allowlist | disabled
  guilds:
    "*":  # Default for all guilds
      requireMention: true
      
    "123456789012345678":  # Specific guild
      slug: my-server
      requireMention: false
      users:
        - "987654321098765432"  # Admin user
      channels:
        general:
          allow: true
          requireMention: true
        bot-channel:
          allow: true
          requireMention: false
          
  # Features
  historyLimit: 20
  replyToMode: first  # off | first | all

# Telegram configuration
telegram:
  enabled: true
  
  # DM settings
  dmPolicy: pairing
  allowFrom: []
  
  # Group settings
  groupPolicy: allowlist
  groupAllowFrom: []
  groups:
    "*":
      requireMention: true
    "-1001234567890":
      requireMention: false
      allowFrom:
        - "123456789"
        
  # Features
  historyLimit: 50
  replyToMode: first
  streamMode: partial  # off | partial | block

# Session settings
session:
  historyLimit: 50
  summaryModel: claude-sonnet-4-20250514
  summarizeOnReset: true
  resetTriggers:
    - /reset
    - /clear

# Skills
skills:
  enabled: true
  # directory: /app/workspace/skills  # auto-detected

# Memory search
memorySearch:
  enabled: true
  extraPaths: []
```

---

## 3. Runtime Config Updates

### 3.1 Bot Commands (User-facing)

```
/config show                    # Show current config (redacted)
/config set <path> <value>     # Set a config value
/config unset <path>           # Remove a config value
/allowlist add <user>          # Add user to allowlist
/allowlist remove <user>       # Remove from allowlist
/activation always|mention     # Set group activation mode
```

Examples:
```
/config set discord.guilds.*.requireMention false
/config set telegram.groups.-1001234567890.requireMention false
/allowlist add discord:123456789
/allowlist add telegram:@username
```

### 3.2 Command Authorization

Only users in `ownerIds` can modify config:

```yaml
security:
  ownerIds:
    - discord:123456789
    - telegram:987654321
```

Or use the first user in each channel's allowFrom.

### 3.3 Config Change Flow

```
User: /config set discord.guilds.*.requireMention false

Bot:
1. Validate user is owner
2. Parse path and value
3. Validate against schema
4. Apply change to in-memory config
5. Write to config file (if configWrites enabled)
6. If hot-reloadable: apply immediately
7. If requires restart: schedule restart
8. Reply with confirmation
```

### 3.4 Hot-Reloadable vs Restart-Required

| Setting | Hot-Reload | Notes |
|---------|------------|-------|
| `*.allowFrom` | ✅ | Allowlists |
| `*.requireMention` | ✅ | Mention gating |
| `*.users` | ✅ | Per-channel users |
| `*.enabled` | ⚠️ | May require restart |
| `*.token` | ❌ | Requires restart |
| `providers.*` | ❌ | Requires restart |
| `skills.*` | ❌ | Requires restart |

---

## 4. Pairing Flow

### 4.1 User Experience

```
[New user DMs bot]

Bot: 👋 Hi! To use this bot, you need approval from the owner.
     
     Your pairing code: ABC123
     Your ID: discord:123456789012345678
     
     Ask the owner to run:
     /pairing approve ABC123

[Owner runs command]

Owner: /pairing approve ABC123

Bot: ✅ Approved discord:123456789012345678
     They can now DM me directly.
```

### 4.2 Pairing Storage

```yaml
# ~/.owliabot/pairing.yaml (auto-managed)
pending:
  ABC123:
    channel: discord
    userId: "123456789012345678"
    username: "user#1234"
    createdAt: 2026-02-05T09:00:00Z
    expiresAt: 2026-02-05T10:00:00Z

approved:
  discord:
    - "123456789012345678"
  telegram:
    - "987654321"
```

### 4.3 Pairing Commands

```
/pairing list              # Show pending requests
/pairing approve <code>    # Approve a request
/pairing reject <code>     # Reject a request
/pairing revoke <id>       # Remove approved user
```

---

## 5. Config Validation

### 5.1 Schema Validation

Use Zod for runtime validation:

```typescript
import { z } from 'zod';

const DiscordDmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  policy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  allowFrom: z.array(z.string()).default([]),
  groupEnabled: z.boolean().default(false),
  groupChannels: z.array(z.string()).optional(),
});

const DiscordGuildChannelSchema = z.object({
  allow: z.boolean().optional(),
  enabled: z.boolean().optional(),
  requireMention: z.boolean().optional(),
  users: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
});

const DiscordGuildSchema = z.object({
  slug: z.string().optional(),
  requireMention: z.boolean().optional(),
  users: z.array(z.string()).optional(),
  channels: z.record(z.string(), DiscordGuildChannelSchema).optional(),
});

const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dm: DiscordDmConfigSchema.optional(),
  groupPolicy: z.enum(['open', 'allowlist', 'disabled']).default('allowlist'),
  guilds: z.record(z.string(), DiscordGuildSchema).optional(),
  historyLimit: z.number().min(0).max(100).default(20),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
});
```

### 5.2 Startup Validation

```typescript
async function loadConfig(): Promise<Config> {
  const raw = await readConfigFile();
  
  // Merge env vars
  const merged = mergeEnvVars(raw);
  
  // Validate
  const result = ConfigSchema.safeParse(merged);
  
  if (!result.success) {
    console.error('❌ Config validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  
  return result.data;
}
```

### 5.3 Error Messages

```
❌ Config validation failed:
  - discord.dm.policy: Invalid enum value. Expected 'pairing' | 'allowlist' | 'open' | 'disabled', received 'allow'
  - discord.guilds.123.channels.general.requireMention: Expected boolean, received string
  
Run 'owliabot config validate' for detailed diagnostics.
```

---

## 6. Migration Path

### 6.1 From Current Config

Current:
```yaml
discord:
  token: xxx
  memberAllowList: ["123"]
  channelAllowList: ["456"]
  requireMentionInGuild: true
```

New:
```yaml
discord:
  # token moved to env var
  dm:
    policy: allowlist
    allowFrom: ["123"]
  groupPolicy: allowlist
  guilds:
    "*":
      requireMention: true
      channels:
        "456":
          allow: true
```

### 6.2 Auto-Migration

On startup, detect old config format and offer migration:

```
⚠️  Detected legacy config format.

Would you like to migrate to the new format?
- Your old config will be backed up to config.yaml.bak
- Tokens will be moved to environment variables

Run: owliabot config migrate --yes
```

---

## 7. Implementation Plan

### Phase 1: Foundation
1. **Config schema redesign** (Zod schemas)
2. **Environment variable support** (tokens, paths)
3. **Config file loading** (YAML, validation)
4. **Docker volume setup** (compose template)

### Phase 2: Runtime Updates
5. **Pairing system** (code generation, storage, approval)
6. **Config commands** (`/config set|show`, `/allowlist`)
7. **Hot-reload for allowlists**

### Phase 3: Polish
8. **Config migration tool**
9. **Validation error messages**
10. **Documentation**

---

## 8. File Structure

```
/app/
├── config/
│   └── config.yaml          # Main config (mounted volume)
├── workspace/
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── MEMORY.md
│   └── memory/
├── sessions/
│   └── *.json               # Session state
└── .owliabot/
    ├── auth/
    │   └── auth-*.json      # OAuth tokens
    └── pairing.yaml         # Pairing state
```

---

## 9. Docker Quick Start Guide

```bash
# 1. Create directory structure
mkdir -p owliabot/{config,workspace,sessions,auth}

# 2. Create config file
cat > owliabot/config/config.yaml << 'EOF'
discord:
  enabled: true
  dm:
    policy: pairing
  groupPolicy: allowlist
  guilds:
    "*":
      requireMention: true

telegram:
  enabled: true
  dmPolicy: pairing
  groups:
    "*":
      requireMention: true

providers:
  - id: anthropic
    model: claude-sonnet-4-20250514
EOF

# 3. Create .env file
cat > owliabot/.env << 'EOF'
DISCORD_BOT_TOKEN=your_discord_token
TELEGRAM_BOT_TOKEN=your_telegram_token
ANTHROPIC_API_KEY=your_anthropic_key
EOF

# 4. Create docker-compose.yaml
cat > owliabot/docker-compose.yaml << 'EOF'
version: '3.8'
services:
  owliabot:
    image: ghcr.io/owliabot/owliabot:latest
    env_file: .env
    volumes:
      - ./config:/app/config
      - ./workspace:/app/workspace
      - ./sessions:/app/sessions
      - ./auth:/home/owliabot/.owliabot/auth
    restart: unless-stopped
EOF

# 5. Start
cd owliabot
docker-compose up -d

# 6. View logs
docker-compose logs -f
```

---

## References

- OpenClaw config docs: `/home/ocbot/n/lib/node_modules/openclaw/docs/gateway/configuration.md`
- OpenClaw config schema: `/home/ocbot/n/lib/node_modules/openclaw/dist/config/`
- Current owliabot config: `/home/ocbot/.openclaw/workspace/owliabot-core/src/config/schema.ts`
