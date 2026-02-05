# OpenClaw Channel Interaction Analysis

> Analysis of OpenClaw's Discord and Telegram interaction patterns for owliabot-core alignment.
> Created: 2026-02-05

## Executive Summary

OpenClaw implements a sophisticated channel interaction system with:
- **Session isolation**: DMs share main session; group channels are isolated
- **Layered access control**: DM policies + group policies + per-channel configs
- **Flexible mention gating**: Multiple detection methods + configurable bypass
- **Rich features**: Streaming, media, reactions, threading, native commands

owliabot-core has basic implementations but lacks the depth of configuration and features.

---

## 1. Session Routing

### OpenClaw Approach
```
DMs         → agent:main:main (shared)
Guild       → agent:<agentId>:discord:channel:<channelId>
Telegram DM → agent:main:main (shared)
Telegram    → agent:<agentId>:telegram:group:<chatId>
Forum topic → agent:<agentId>:telegram:group:<chatId>:topic:<threadId>
```

### owliabot-core Current State
- Basic session key: `<agentId>:<channel>:<chatType>:<userId|groupId>`
- ✅ Already supports DM vs group isolation
- ⚠️ No thread/topic isolation

### Gap
- Add topic/thread-specific session keys for Telegram forums and Discord threads

---

## 2. DM Access Control

### OpenClaw Approach
```typescript
// channels.discord.dm.policy: "pairing" | "allowlist" | "open" | "disabled"
// channels.telegram.dmPolicy: same options

// Pairing flow:
// 1. Unknown sender DMs bot
// 2. Bot replies with pairing code
// 3. Admin runs: openclaw pairing approve discord <CODE>
// 4. User added to allowlist
```

Config example:
```json5
{
  channels: {
    discord: {
      dm: {
        enabled: true,
        policy: "pairing",
        allowFrom: ["123456789", "steipete"]
      }
    }
  }
}
```

### owliabot-core Current State
- Basic `memberAllowList` / `allowList` (array of user IDs)
- No pairing flow
- No policy modes

### Gap - High Priority
1. **Add DM policy modes**: `pairing`, `allowlist`, `open`, `disabled`
2. **Implement pairing flow**: Code generation, approval command, storage
3. **Support multiple ID formats**: User ID, username, mention format

---

## 3. Group/Guild Policies

### OpenClaw Approach
```typescript
// channels.discord.groupPolicy: "open" | "allowlist" | "disabled"
// channels.discord.guilds.<guildId>.channels.<channelId>: { allow, requireMention, users, skills }

// Layered configuration:
// 1. Global groupPolicy
// 2. Per-guild settings (guilds.<id>.requireMention, users)
// 3. Per-channel settings (channels.<id>.allow, requireMention, users, skills)
// 4. Wildcard support ("*" for defaults)
```

Config example:
```json5
{
  channels: {
    discord: {
      groupPolicy: "allowlist",
      guilds: {
        "*": { requireMention: true },
        "123456789": {
          slug: "my-server",
          requireMention: false,
          users: ["987654321"],
          channels: {
            help: { allow: true, requireMention: true },
            general: { allow: true, users: ["specific-user"] }
          }
        }
      }
    }
  }
}
```

### owliabot-core Current State
- `channelAllowList`: Simple array of channel IDs
- `requireMentionInGuild`: Global boolean
- No per-guild or per-channel configuration

### Gap - High Priority
1. **Add groupPolicy modes**: `open`, `allowlist`, `disabled`
2. **Implement guild configuration**: Per-guild settings with wildcard support
3. **Implement channel configuration**: Per-channel settings within guilds
4. **Add user allowlists per channel/guild**

---

## 4. Mention Detection

### OpenClaw Approach
```typescript
// Multiple detection methods:
// 1. Bot ID mention (@bot)
// 2. Regex patterns from config (agents.list[].groupChat.mentionPatterns)
// 3. Implicit mention (reply to bot's message)
// 4. @everyone / role mentions

// Special handling:
// - Commands bypass mention requirement
// - Reply-to-bot counts as implicit mention
// - Configurable patterns for custom triggers
```

### owliabot-core Current State (after PR #48)
- ✅ Bot ID mention detection
- ✅ ctx.mentioned passed to gateway
- ✅ Reply-to-bot detection (Telegram)
- ⚠️ No custom patterns
- ⚠️ No command bypass

### Gap - Medium Priority
1. **Add mentionPatterns config**: Regex patterns for custom triggers
2. **Command bypass**: Control commands should bypass mention gate
3. **Implicit mention for Discord**: Reply-to-bot should count

---

## 5. History Context

### OpenClaw Approach
```typescript
// channels.discord.historyLimit: 20 (default)
// channels.telegram.historyLimit: 50 (default)

// Injects recent channel messages as context:
// [from: User#1234 (id)] message content
// [from: Bot#5678 (id)] bot response

// Truncated/cleared after reply to prevent bloat
```

### owliabot-core Current State
- Session transcript history (persisted)
- No group history context injection

### Gap - Medium Priority
1. **Add historyLimit config**
2. **Inject recent group messages as context**
3. **Include message IDs for reply targeting**

---

## 6. Reply Threading

### OpenClaw Approach
```typescript
// channels.discord.replyToMode: "off" | "first" | "all"
// channels.telegram.replyToMode: "off" | "first" | "all"

// Reply tags in model output:
// [[reply_to_current]] → reply to triggering message
// [[reply_to:<id>]] → reply to specific message

// "first" = only first chunk replies
// "all" = every chunk is a reply
```

### owliabot-core Current State
- Basic `replyToId` in outbound messages
- No reply tag parsing
- No mode configuration

### Gap - Low Priority
1. **Add replyToMode config**
2. **Parse reply tags from model output**
3. **Apply mode to chunked responses**

---

## 7. Channel Actions/Tools

### OpenClaw Approach
```typescript
// channels.discord.actions: {
//   reactions: true,
//   threads: true,
//   pins: true,
//   search: true,
//   messages: true,
//   // ... many more
// }

// Exposes channel-specific tools to agent:
// - React to messages
// - Create/manage threads
// - Pin/unpin messages
// - Search messages
// - Send/edit/delete messages
```

### owliabot-core Current State
- No channel-specific tools
- Basic send only

### Gap - Future Phase
1. **Design action gating config**
2. **Implement reaction tools**
3. **Implement thread tools**
4. **Implement message management tools**

---

## 8. Streaming (Telegram Draft)

### OpenClaw Approach
```typescript
// channels.telegram.streamMode: "off" | "partial" | "block"

// Draft streaming:
// - Uses Telegram's draft bubble API
// - Shows typing/thinking indicator
// - Updates draft as tokens stream in
// - Final message replaces draft
```

### owliabot-core Current State
- No streaming support
- Waits for full response

### Gap - Future Phase
1. **Add streamMode config**
2. **Implement draft streaming for Telegram**
3. **Consider Discord streaming (edit-based)**

---

## 9. Media Handling

### OpenClaw Approach
```typescript
// channels.discord.mediaMaxMb: 8
// channels.telegram.mediaMaxMb: 5

// Inbound: Downloads, processes, stores temporarily
// Outbound: Uploads files, images, voice
// Vision: Routes images to vision-capable models
```

### owliabot-core Current State
- No media handling

### Gap - Future Phase
1. **Add media config**
2. **Implement inbound media download**
3. **Implement outbound media upload**
4. **Vision model routing**

---

## 10. Native Commands

### OpenClaw Approach
```typescript
// Discord: Registers slash commands via API
// Telegram: Registers bot menu via BotFather API

// /status, /reset, /model, /help, etc.
// Custom commands via config
```

### owliabot-core Current State
- Text commands only (`/help`, `/reset`, etc.)
- Not registered with platform APIs

### Gap - Medium Priority
1. **Discord slash command registration**
2. **Telegram bot menu registration**
3. **Command allowlist enforcement**

---

## 11. Group DMs (Discord)

### OpenClaw Approach
```typescript
// channels.discord.dm.groupEnabled: false (default)
// channels.discord.dm.groupChannels: ["openclaw-dm"]

// Group DMs are disabled by default
// Can enable with channel allowlist
```

### owliabot-core Current State
- No distinction between regular DMs and group DMs
- Group DMs likely processed as regular DMs

### Gap - Low Priority
1. **Detect group DMs**
2. **Add groupEnabled config**
3. **Add groupChannels allowlist**

---

## Implementation Plan

### Phase 1: Core Parity (High Priority)
1. **DM Policy System**
   - Add policy modes (`pairing`, `allowlist`, `open`, `disabled`)
   - Implement pairing flow with code generation
   - Add pairing approval command
   
2. **Guild/Group Configuration**
   - Redesign config schema for nested guild/channel config
   - Implement groupPolicy modes
   - Add per-guild and per-channel settings
   - Support wildcard (`"*"`) patterns

3. **Mention Enhancement**
   - Add mentionPatterns config
   - Command bypass for mention gate
   - Implicit mention (reply-to-bot) for Discord

### Phase 2: Enhanced Features (Medium Priority)
4. **History Context**
   - Add historyLimit config
   - Inject recent group messages
   - Message ID exposure for reply targeting

5. **Native Commands**
   - Discord slash command registration
   - Telegram bot menu registration
   - Command allowlist enforcement

6. **Reply Threading**
   - Add replyToMode config
   - Reply tag parsing
   - Mode-based reply behavior

### Phase 3: Advanced Features (Future)
7. **Channel Actions/Tools**
8. **Streaming**
9. **Media Handling**
10. **Multi-account Support**

---

## Config Schema Changes

### Current owliabot-core
```typescript
interface Config {
  discord?: {
    token: string;
    memberAllowList?: string[];
    channelAllowList?: string[];
    requireMentionInGuild?: boolean;
  };
  telegram?: {
    token: string;
    allowList?: string[];
    groupAllowList?: string[];
  };
  group?: {
    activation?: "always" | "mention";
  };
}
```

### Proposed (OpenClaw-aligned)
```typescript
interface Config {
  discord?: {
    token: string;
    enabled?: boolean;
    
    // DM settings
    dm?: {
      enabled?: boolean;
      policy?: "pairing" | "allowlist" | "open" | "disabled";
      allowFrom?: string[];
      groupEnabled?: boolean;
      groupChannels?: string[];
    };
    
    // Group settings
    groupPolicy?: "open" | "allowlist" | "disabled";
    guilds?: {
      [guildId: string]: {
        slug?: string;
        requireMention?: boolean;
        users?: string[];
        channels?: {
          [channelId: string]: {
            allow?: boolean;
            enabled?: boolean;
            requireMention?: boolean;
            users?: string[];
            skills?: string[];
            systemPrompt?: string;
          };
        };
      };
    };
    
    // Features
    historyLimit?: number;
    replyToMode?: "off" | "first" | "all";
    mediaMaxMb?: number;
  };
  
  telegram?: {
    token: string;
    enabled?: boolean;
    
    // DM settings
    dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
    allowFrom?: string[];
    
    // Group settings
    groupPolicy?: "open" | "allowlist" | "disabled";
    groupAllowFrom?: string[];
    groups?: {
      [groupId: string]: {
        requireMention?: boolean;
        allowFrom?: string[];
        skills?: string[];
        systemPrompt?: string;
        topics?: {
          [topicId: string]: {
            requireMention?: boolean;
            skills?: string[];
          };
        };
      };
    };
    
    // Features
    historyLimit?: number;
    replyToMode?: "off" | "first" | "all";
    streamMode?: "off" | "partial" | "block";
    mediaMaxMb?: number;
  };
}
```

---

## References

- OpenClaw Discord plugin: `/home/ocbot/n/lib/node_modules/openclaw/dist/channels/plugins/discord.js`
- OpenClaw Telegram plugin: `/home/ocbot/n/lib/node_modules/openclaw/dist/channels/plugins/telegram.js`
- OpenClaw Discord docs: `/home/ocbot/n/lib/node_modules/openclaw/docs/channels/discord.md`
- OpenClaw Telegram docs: `/home/ocbot/n/lib/node_modules/openclaw/docs/channels/telegram.md`
- OpenClaw mention handling: `/home/ocbot/n/lib/node_modules/openclaw/dist/discord/monitor/message-handler.preflight.js`
