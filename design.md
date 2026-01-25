# OwliaBot - Crypto-Native AI Agent

> 为 Crypto 用户设计的 Self-Hosted AI Agent，安全优先，本地运行。

---

## 目录

1. [设计理念](#1-设计理念)
2. [安全模型](#2-安全模型)
3. [架构总览](#3-架构总览)
4. [模块设计](#4-模块设计)
5. [接口定义](#5-接口定义)
6. [工作空间](#6-工作空间)
7. [依赖策略](#7-依赖策略)
8. [开发路线](#8-开发路线)

---

## 1. 设计理念

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **Local-first** | 完全本地运行，私钥永不离开设备 |
| **最小依赖** | 依赖越少，攻击面越小 |
| **可审计** | 代码量小，社区可审查 |
| **渠道精简** | 只支持 Telegram + Discord |
| **扩展性** | Tool 接口设计良好，方便扩展 |

### 1.2 与 Clawdbot 的关系

OwliaBot 借鉴 Clawdbot 的架构理念，但针对 Crypto 场景重新设计：

| 方面 | Clawdbot | OwliaBot |
|------|----------|----------|
| 渠道 | 7+ (TG/WA/DC/Slack/Signal/iMsg/Teams) | 2 (Telegram + Discord) |
| 浏览器 | Playwright 集成 | 不需要 |
| 图片处理 | sharp (native) | 无或 pure-JS |
| 签名 | 无 | 分层安全模型 |
| 目标依赖数 | 50+ | < 30 |

---

## 2. 安全模型

### 2.1 密钥分层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        KEY SECURITY TIERS                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Tier 1: 用户确认型                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  场景: 任何需要签名确认的操作                                    ││
│  │  方案: 用户 Companion App (iOS/Android)                          ││
│  │                                                                  ││
│  │  流程:                                                           ││
│  │  Bot ──[推送请求]──▶ App ──[用户确认]──▶ 签名 ──▶ 广播           ││
│  │                                                                  ││
│  │  App 职责:                                                       ││
│  │  - 显示交易详情（金额、目标、Gas）                               ││
│  │  - 生物识别 / PIN 确认                                           ││
│  │  - 本地签名，返回签名结果                                        ││
│  │  - 私钥永不离开 App                                              ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Tier 2: 自动化小额                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  场景: 自动化操作，但金额受限                                    ││
│  │  方案: Session Key (可弃，无需备份)                              ││
│  │                                                                  ││
│  │  特点:                                                           ││
│  │  - 由 Bot 本地生成，不导出                                       ││
│  │  - 丢了就丢了，资金损失可控                                      ││
│  │  - 定期轮换 + 余额上限                                           ││
│  │                                                                  ││
│  │  用途: Gas 代付、小额 swap、自动 claim 等                        ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Tier 3: 大额自动化                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  场景: 大额 + 需要自动化（如 DeFi 策略）                         ││
│  │  方案: 智能合约钱包 + Session Key 权限                           ││
│  │                                                                  ││
│  │  ┌───────────────────────────────────────────────────────────┐  ││
│  │  │ Smart Wallet Contract                                      │  ││
│  │  │                                                            │  ││
│  │  │  Session Key 权限限制:                                     │  ││
│  │  │  - 只能调用白名单合约                                      │  ││
│  │  │  - 单笔限额 / 日限额                                       │  ││
│  │  │  - 只能操作特定 token                                      │  ││
│  │  │  - 有效期限制                                              │  ││
│  │  │                                                            │  ││
│  │  │  用户主钥:                                                 │  ││
│  │  │  - 可随时撤销 session key                                  │  ││
│  │  │  - 可提取所有资金                                          │  ││
│  │  │  - 可修改权限规则                                          │  ││
│  │  └───────────────────────────────────────────────────────────┘  ││
│  │                                                                  ││
│  │  参考: ERC-4337 / Safe{Wallet} / Biconomy Session Keys          ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 安全原则

1. **私钥隔离**: 主私钥永远不进入 Bot 进程
2. **最小权限**: Session Key 只有执行任务所需的最小权限
3. **可撤销**: 用户随时可以撤销任何 Session Key
4. **可审计**: 所有操作留痕，可追溯
5. **限额保护**: 自动化操作有金额上限

---

## 3. 架构总览

### 3.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        OWLIABOT CORE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    ENTRY LAYER                               ││
│  │  CLI (commander) → Config (yaml/env) → Gateway              ││
│  └─────────────────────────────────────────────────────────────┘│
│                               │                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    CHANNEL LAYER                             ││
│  │                                                              ││
│  │   ┌────────────┐   ┌────────────┐                           ││
│  │   │ Telegram   │   │ Discord   │                            ││
│  │   │ (grammy)   │   │ (discord.js)│                          ││
│  │   └────────────┘   └────────────┘                           ││
│  │                                                              ││
│  │   统一接口: ChannelPlugin { receive(), send() }             ││
│  └─────────────────────────────────────────────────────────────┘│
│                               │                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    AGENT RUNTIME                             ││
│  │                                                              ││
│  │   ┌───────────────────────────────────────────────────────┐ ││
│  │   │ System Prompt Builder                                  │ ││
│  │   │  - 读取 SOUL.md / IDENTITY.md / USER.md               │ ││
│  │   │  - 注入 Tools 说明                                     │ ││
│  │   │  - 注入 Runtime 信息                                   │ ││
│  │   └───────────────────────────────────────────────────────┘ ││
│  │                                                              ││
│  │   ┌───────────────────────────────────────────────────────┐ ││
│  │   │ LLM Runner                                             │ ││
│  │   │  - 支持多 provider (Anthropic, OpenAI, OpenRouter)    │ ││
│  │   │  - Failover 机制                                       │ ││
│  │   │  - 流式输出                                            │ ││
│  │   └───────────────────────────────────────────────────────┘ ││
│  │                                                              ││
│  │   ┌───────────────────────────────────────────────────────┐ ││
│  │   │ Tool Executor                                          │ ││
│  │   │  - 统一的 Tool 接口                                    │ ││
│  │   │  - 安全级别检查                                        │ ││
│  │   │  - 确认流程（如需要）                                  │ ││
│  │   └───────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                               │                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SUPPORTING SYSTEMS                        ││
│  │                                                              ││
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      ││
│  │   │ Cron         │  │ Memory       │  │ Session      │      ││
│  │   │ 定时任务      │  │ 语义搜索     │  │ 会话管理     │      ││
│  │   └──────────────┘  └──────────────┘  └──────────────┘      ││
│  └─────────────────────────────────────────────────────────────┘│
│                               │                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SIGNER LAYER                              ││
│  │                                                              ││
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      ││
│  │   │ App Bridge   │  │ Session Key  │  │ Contract     │      ││
│  │   │ (Tier 1)     │  │ (Tier 2)     │  │ (Tier 3)     │      ││
│  │   └──────────────┘  └──────────────┘  └──────────────┘      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 消息处理流程

```
用户消息 (Telegram/Discord)
    │
    ▼
┌─────────────────┐
│ Channel Plugin  │  接收、解析、构建 MsgContext
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Security Check  │  检查发送者权限 (allowlist)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Command Parse   │  解析 /help, /status 等命令
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
 命令响应   Agent 处理
    │         │
    │         ▼
    │    ┌─────────────────┐
    │    │ System Prompt   │  构建完整 prompt
    │    │ + User Message  │
    │    └────────┬────────┘
    │             │
    │             ▼
    │    ┌─────────────────┐
    │    │ LLM Runner      │  调用 AI，流式输出
    │    └────────┬────────┘
    │             │
    │             ▼
    │    ┌─────────────────┐
    │    │ Tool Executor   │  执行工具调用（如有）
    │    └────────┬────────┘
    │             │
    └──────┬──────┘
           │
           ▼
┌─────────────────┐
│ Response Send   │  发送回复
└─────────────────┘
```

---

## 4. 模块设计

### 4.1 目录结构

```
src/
├── entry.ts                # 程序入口
├── config/
│   ├── schema.ts           # 配置 Schema (Zod)
│   ├── loader.ts           # 配置加载
│   └── types.ts            # 配置类型
│
├── gateway/
│   ├── server.ts           # 主服务器
│   ├── http.ts             # HTTP 接口 (健康检查等)
│   └── bridge.ts           # 内部通信
│
├── channels/
│   ├── interface.ts        # ChannelPlugin 接口
│   ├── registry.ts         # 渠道注册表
│   ├── telegram/
│   │   ├── index.ts        # Telegram 实现
│   │   ├── monitor.ts      # 消息监听
│   │   └── send.ts         # 消息发送
│   └── discord/
│       ├── index.ts        # Discord 实现
│       ├── monitor.ts      # 消息监听
│       └── send.ts         # 消息发送
│
├── agent/
│   ├── runner.ts           # LLM 调用主逻辑
│   ├── system-prompt.ts    # System Prompt 构建
│   ├── session.ts          # Session 管理
│   ├── model.ts            # Model 解析
│   └── tools/
│       ├── interface.ts    # Tool 接口定义 ★核心
│       ├── registry.ts     # Tool 注册表
│       └── executor.ts     # Tool 执行器
│
├── workspace/
│   ├── loader.ts           # 加载 SOUL/IDENTITY/USER/MEMORY
│   ├── memory-search.ts    # 语义搜索
│   └── memory-index.ts     # 向量索引
│
├── cron/
│   ├── service.ts          # Cron 服务
│   ├── scheduler.ts        # 调度器 (croner)
│   ├── store.ts            # 任务持久化
│   └── heartbeat.ts        # Heartbeat 执行
│
├── signer/
│   ├── interface.ts        # Signer 接口定义
│   ├── types.ts            # SignRequest, SignResult
│   ├── session-key.ts      # Tier 2: 本地 session key
│   ├── app-bridge.ts       # Tier 1: 与 Companion App 通信
│   └── contract.ts         # Tier 3: 智能合约钱包接口
│
└── utils/
    ├── logger.ts           # 日志
    └── crypto.ts           # 加密工具
```

### 4.2 模块职责

| 模块 | 职责 | 关键文件 |
|------|------|----------|
| **config** | 配置加载、验证、热重载 | `schema.ts` |
| **gateway** | HTTP 服务、健康检查 | `server.ts` |
| **channels** | 消息收发、渠道抽象 | `interface.ts` |
| **agent** | LLM 调用、System Prompt、Tool 执行 | `runner.ts`, `tools/interface.ts` |
| **workspace** | 人格加载、记忆搜索 | `loader.ts` |
| **cron** | 定时任务、Heartbeat | `service.ts` |
| **signer** | 签名抽象、分层安全 | `interface.ts` |

---

## 5. 接口定义

### 5.1 Channel 接口

```typescript
// src/channels/interface.ts

export interface ChannelPlugin {
  id: ChannelId;                    // "telegram" | "discord"
  
  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // 消息处理
  onMessage(handler: MessageHandler): void;
  
  // 消息发送
  send(target: string, message: OutboundMessage): Promise<void>;
  
  // 能力声明
  capabilities: ChannelCapabilities;
}

export interface MessageHandler {
  (ctx: MsgContext): Promise<void>;
}

export interface MsgContext {
  // 发送者
  from: string;                     // 唯一标识
  senderName: string;               // 显示名称
  senderUsername?: string;          // @username
  
  // 消息
  body: string;                     // 消息正文
  messageId: string;                // 消息 ID
  replyToId?: string;               // 回复的消息 ID
  
  // 渠道
  channel: ChannelId;
  chatType: "direct" | "group" | "channel";
  groupId?: string;
  groupName?: string;
  
  // 媒体
  mediaUrls?: string[];
  audioUrl?: string;
  
  // 元数据
  timestamp: number;
}

export interface ChannelCapabilities {
  reactions: boolean;
  threads: boolean;
  buttons: boolean;
  markdown: boolean;
  maxMessageLength: number;
}
```

#### 群聊行为

| 场景 | MVP | 后续 |
|------|-----|------|
| 私聊 | ✅ 支持 | - |
| 群聊 | ❌ 忽略 | 可配置 |

**MVP 策略：**
- `chatType === "direct"` → 处理
- `chatType === "group" | "channel"` → 忽略

**后续群聊配置（Phase 2+）：**

```yaml
# config.yaml
channels:
  telegram:
    allowGroups: false      # MVP: false
  discord:
    allowGroups: true       # 后续可开启
    groupTrigger: "mention" # "mention" | "reply" | "all"
    groupSession: "per-user" # "per-user" | "shared"
    groupAllowList:         # 可选：限制谁能在群里用
      - "883499266"
```

**群聊 Session Key（后续）：**

```typescript
function getSessionKey(ctx: MsgContext): SessionKey {
  if (ctx.chatType === "direct") {
    return `${ctx.channel}:${ctx.from}`;
  }
  
  // 群聊场景
  if (groupSession === "per-user") {
    return `${ctx.channel}:${ctx.groupId}:${ctx.from}`;
  } else {
    return `${ctx.channel}:${ctx.groupId}`;
  }
}
```

### 5.2 Tool 接口

```typescript
// src/agent/tools/interface.ts

export interface ToolDefinition {
  // 基本信息
  name: string;
  description: string;
  parameters: JsonSchema;
  
  // 安全元数据
  security: ToolSecurity;
  
  // 执行函数
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolSecurity {
  level: "read" | "write" | "sign";
  
  // 需要用户确认？
  confirmRequired?: boolean;
  
  // 最大操作金额 (wei)，仅对 sign 级别有效
  maxValue?: bigint;
  
  // 允许的目标合约（白名单）
  allowedContracts?: string[];
}

export interface ToolContext {
  // Session 信息
  sessionKey: string;
  agentId: string;
  
  // 注入的签名器
  signer: SignerInterface;
  
  // 配置
  config: ToolConfig;
  
  // 用户确认（如果需要）
  requestConfirmation: (req: ConfirmationRequest) => Promise<boolean>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ConfirmationRequest {
  type: "transaction" | "action";
  title: string;
  description: string;
  details?: Record<string, string>;
  
  // 交易特定字段
  transaction?: {
    to: string;
    value: bigint;
    data: string;
    chainId: number;
  };
}
```

#### 确认流程

| 安全级别 | 确认方式 | 示例 |
|----------|----------|------|
| `read` | 不需要确认 | 查价格、查余额 |
| `write` | Inline 按钮 | 发消息到群、创建提醒 |
| `sign` | Transaction Page / Companion App | 转账、合约调用 |

**确认流程分发：**

```typescript
async function requestConfirmation(req: ConfirmationRequest): Promise<boolean> {
  if (req.type === "transaction") {
    // sign 级别: 跳转 Transaction Page / Companion App
    return await requestTransactionApproval(req);
  } else {
    // write 级别: Inline 按钮
    return await requestInlineConfirmation(req);
  }
}

// Inline 确认 (Telegram 示例)
async function requestInlineConfirmation(req: ConfirmationRequest): Promise<boolean> {
  const msg = await bot.sendMessage(chatId, formatConfirmation(req), {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ 确认", callback_data: `confirm:${req.id}` },
        { text: "❌ 取消", callback_data: `cancel:${req.id}` },
      ]],
    },
  });
  
  return await waitForCallback(req.id, { timeout: 60_000 });
}
```

**MVP 策略：**
- Phase 1: 只做 `read` + `sign`（write 操作暂不实现）
- Phase 2: 加入 `write` + Inline 确认

### 5.3 Signer 接口

```typescript
// src/signer/interface.ts

export interface SignerInterface {
  // 获取地址
  getAddress(): Promise<string>;
  
  // 签名消息
  signMessage(message: string): Promise<string>;
  
  // 签名交易
  signTransaction(tx: TransactionRequest): Promise<string>;
  
  // 发送交易（签名 + 广播）
  sendTransaction(tx: TransactionRequest): Promise<TransactionReceipt>;
  
  // 元数据
  tier: SignerTier;
  canAutoSign: boolean;
  maxAutoSignValue: bigint;
}

export type SignerTier = "app" | "session-key" | "contract";

export interface TransactionRequest {
  to: string;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  chainId: number;
}
```

### 5.4 Memory 接口

#### 实现策略

| 阶段 | 方案 | 说明 |
|------|------|------|
| **MVP** | 关键词匹配 | glob 遍历 + includes 匹配，无外部依赖 |
| **后续** | 语义搜索 | Embedding API + SQLite/sqlite-vec |

**MVP 实现（关键词匹配）：**

```typescript
// src/workspace/memory-search.ts

import { glob } from "node:fs/promises";
import { readFile } from "node:fs/promises";

export async function search(query: string, options?: SearchOptions): Promise<MemorySearchResult[]> {
  const files = await glob("memory/**/*.md", { cwd: workspaceDir });
  const results: MemorySearchResult[] = [];
  const queryLower = query.toLowerCase();
  
  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const lines = content.split("\n");
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        results.push({
          path: file,
          startLine: Math.max(0, i - 2),
          endLine: Math.min(lines.length - 1, i + 2),
          score: 1.0,  // 简单匹配，score 固定为 1
          snippet: lines.slice(Math.max(0, i - 2), i + 3).join("\n"),
        });
      }
    }
  }
  
  return results.slice(0, options?.maxResults ?? 10);
}
```

**后续升级路径（语义搜索）：**

```typescript
// 升级时只需替换 search 实现，接口不变
// Embedding: OpenAI text-embedding-3-small 或 Gemini embedding-001
// 存储: SQLite + sqlite-vec 扩展
// 索引: 启动时全量 + 文件 watch 增量
```

#### 接口定义

```typescript
export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;       // MVP 固定 1.0，语义搜索时为相似度
  snippet: string;
}

export interface MemoryManager {
  // 搜索记忆
  search(query: string, options?: SearchOptions): Promise<MemorySearchResult[]>;
  
  // 获取指定行
  get(path: string, from?: number, lines?: number): Promise<string>;
  
  // 索引更新 (MVP 为空操作，后续实现时触发重建索引)
  reindex(): Promise<void>;
}

export interface SearchOptions {
  maxResults?: number;
  minScore?: number;   // MVP 忽略此参数
  paths?: string[];    // 限定搜索路径
}
```

### 5.5 LLM Runner 接口

#### Failover 策略

| 阶段 | 方案 | 说明 |
|------|------|------|
| **MVP** | 简单线性 fallback | Provider A 失败就试 B |
| **后续** | 智能路由 | 根据错误类型决定重试/切换 |

**错误分类：**

| 错误类型 | 处理 |
|----------|------|
| 429 (Rate Limit) | 切换下一个 provider |
| 5xx (服务器错误) | 切换下一个 provider |
| Timeout | 切换下一个 provider |
| 401/403 (Auth) | 直接抛出，不重试 |
| 400 (Bad Request) | 直接抛出，不重试 |

**配置示例：**

```yaml
# config.yaml
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: ${ANTHROPIC_API_KEY}
    priority: 1
  - id: openai
    model: gpt-4o
    apiKey: ${OPENAI_API_KEY}
    priority: 2
  - id: openrouter
    model: anthropic/claude-3.5-sonnet
    apiKey: ${OPENROUTER_API_KEY}
    priority: 3
```

#### 接口定义

```typescript
// src/agent/runner.ts

export interface LLMProvider {
  id: string;
  model: string;
  apiKey: string;
  priority: number;
  baseUrl?: string;  // 自定义 endpoint
}

export interface LLMRunner {
  // 调用 LLM，自动 failover
  call(messages: Message[], options?: CallOptions): Promise<LLMResponse>;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  provider: string;  // 实际使用的 provider
}

// Failover 实现
async function callWithFailover(
  providers: LLMProvider[],
  messages: Message[],
  options?: CallOptions,
): Promise<LLMResponse> {
  const sorted = providers.sort((a, b) => a.priority - b.priority);
  
  for (const provider of sorted) {
    try {
      return await callProvider(provider, messages, options);
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`Provider ${provider.id} failed, trying next...`);
        continue;
      }
      throw err;
    }
  }
  
  throw new Error("All providers failed");
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HTTPError) {
    return [429, 500, 502, 503, 504].includes(err.status);
  }
  if (err instanceof TimeoutError) {
    return true;
  }
  return false;
}
```

#### Provider 注册制

为了方便扩展新的 LLM provider，使用注册制而非硬编码 switch：

```typescript
// src/agent/providers/registry.ts

type ProviderFn = (
  config: { apiKey: string; model: string; baseUrl?: string },
  messages: Message[],
  options?: CallOptions
) => Promise<LLMResponse>;

class ProviderRegistry {
  private providers = new Map<string, ProviderFn>();

  register(id: string, fn: ProviderFn): void {
    this.providers.set(id, fn);
  }

  get(id: string): ProviderFn | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }
}

export const providerRegistry = new ProviderRegistry();

// 初始化时注册
import { callAnthropic } from "./anthropic.js";
import { callOpenAI } from "./openai.js";
import { callOpenRouter } from "./openrouter.js";

providerRegistry.register("anthropic", callAnthropic);
providerRegistry.register("openai", callOpenAI);
providerRegistry.register("openrouter", callOpenRouter);
```

**使用方式：**

```typescript
// runner.ts
async function callProvider(provider: LLMProvider, ...): Promise<LLMResponse> {
  const fn = providerRegistry.get(provider.id);
  if (!fn) {
    throw new Error(`Unknown provider: ${provider.id}`);
  }
  return fn({ apiKey: provider.apiKey, model: provider.model }, messages, options);
}
```

**新增 Provider 步骤：**
1. 创建 `src/agent/providers/xxx.ts`
2. 实现 `callXxx()` 函数
3. 在 registry 中注册 `providerRegistry.register("xxx", callXxx)`

### 5.6 Session 接口

#### Session 策略

| 维度 | MVP 方案 | 说明 |
|------|----------|------|
| **粒度** | Per channel-user | TG 和 Discord 分开，同平台连续 |
| **窗口** | 滑动窗口 | 保留最近 20 轮对话 |
| **持久化** | JSONL 文件 | `~/.owliabot/sessions/{key}.jsonl` |
| **压缩** | 不做 | 后续可加 `/compact` 命令 |

**Session Key 格式：**

```
sessionKey = "${channel}:${peerId}"

示例:
- telegram:883499266
- discord:123456789012345678
```

#### 接口定义

```typescript
// src/agent/session.ts

export interface SessionManager {
  // 获取或创建 session
  get(key: SessionKey): Promise<Session>;
  
  // 追加消息
  append(key: SessionKey, message: Message): Promise<void>;
  
  // 获取历史（用于构建 prompt）
  getHistory(key: SessionKey, maxTurns?: number): Promise<Message[]>;
  
  // 清空 session
  clear(key: SessionKey): Promise<void>;
  
  // 列出所有 sessions
  list(): Promise<SessionKey[]>;
}

export type SessionKey = `${ChannelId}:${string}`;

export interface Session {
  key: SessionKey;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// 持久化格式 (JSONL)
// 每行一条消息，便于追加写入
// ~/.owliabot/sessions/telegram:883499266.jsonl
// {"role":"user","content":"hello","timestamp":1706000000}
// {"role":"assistant","content":"hi","timestamp":1706000001}
```

#### 窗口管理

```typescript
// 获取历史时自动截断
async function getHistory(key: SessionKey, maxTurns = 20): Promise<Message[]> {
  const allMessages = await readSessionFile(key);
  
  // 保留最近 maxTurns 轮对话 (user + assistant = 1 轮)
  const turns: Message[][] = [];
  let currentTurn: Message[] = [];
  
  for (const msg of allMessages) {
    currentTurn.push(msg);
    if (msg.role === "assistant") {
      turns.push(currentTurn);
      currentTurn = [];
    }
  }
  
  // 取最后 N 轮
  const recentTurns = turns.slice(-maxTurns);
  return recentTurns.flat();
}
```

### 5.7 Notifications 接口

#### 通知通道策略

Heartbeat 等主动推送场景需要决定发送到哪个通道。

| 方案 | MVP |
|------|-----|
| 配置默认通道 | ✅ |
| 发到最近活跃通道 | 后续 |
| 全部通道都发 | 不做 |

**配置：**

```yaml
# config.yaml
notifications:
  # 主要通知通道
  channel: telegram:883499266
  
  # 或多通道 fallback（后续支持）
  # channels:
  #   - telegram:883499266
  #   - discord:123456789
```

#### 接口定义

```typescript
// src/notifications/service.ts

export interface NotificationService {
  // 发送通知到配置的通道
  notify(message: string, options?: NotifyOptions): Promise<void>;
  
  // 发送到指定通道
  notifyChannel(channel: string, message: string): Promise<void>;
}

export interface NotifyOptions {
  priority?: "normal" | "high";
  silent?: boolean;  // 静默通知（不响铃）
}

// 实现
async function notify(message: string, options?: NotifyOptions): Promise<void> {
  const channel = config.notifications?.channel;
  
  if (!channel) {
    // fallback: 最近活跃的通道
    const lastActive = await getLastActiveChannel();
    if (lastActive) {
      await sendToChannel(lastActive, message);
    }
    return;
  }
  
  await sendToChannel(channel, message);
}
```

### 5.8 Auth 接口

#### 认证方式

OwliaBot 使用 Anthropic OAuth 流程获取 token，与 Claude CLI 相同机制。

| 方式 | 说明 |
|------|------|
| **Setup Token** | 通过 OAuth 流程获取，保存到本地 |
| Console API Key | 不支持（需要开发者账户） |

**OAuth Token 特点：**
- 格式：`sk-ant-oat01-...`
- 使用 Claude Pro/Max 订阅额度
- 有 refresh token，可自动续期
- 同一账户可有多个 session，互不冲突

#### CLI 命令

```bash
# 交互式设置（打开浏览器授权）
owliabot auth setup

# 查看当前认证状态
owliabot auth status

# 清除认证
owliabot auth logout
```

#### 接口定义

```typescript
// src/auth/types.ts

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // Unix timestamp
}

export interface AuthManager {
  // 启动 OAuth 流程
  setup(): Promise<AuthToken>;
  
  // 获取当前 token（自动刷新如果过期）
  getToken(): Promise<string | null>;
  
  // 刷新 token
  refresh(): Promise<AuthToken>;
  
  // 检查是否已认证
  isAuthenticated(): Promise<boolean>;
  
  // 清除认证
  logout(): Promise<void>;
}
```

#### 存储位置

```
~/.owliabot/
├── auth.json           # OAuth token
└── config.yaml         # 用户配置（不含敏感信息）
```

**auth.json 格式：**

```json
{
  "anthropic": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1769346143770
  }
}
```

#### OAuth 流程

```
1. 用户运行 `owliabot auth setup`
2. 打开浏览器 → Anthropic 登录页
3. 用户授权
4. 回调获取 code
5. 用 code 换取 access_token + refresh_token
6. 保存到 ~/.owliabot/auth.json
```

**自动刷新：**

```typescript
async function getToken(): Promise<string | null> {
  const auth = await loadAuth();
  if (!auth) return null;
  
  // 提前 5 分钟刷新
  if (Date.now() > auth.expiresAt - 5 * 60 * 1000) {
    const newAuth = await refresh(auth.refreshToken);
    await saveAuth(newAuth);
    return newAuth.accessToken;
  }
  
  return auth.accessToken;
}
```

---

## 6. 工作空间

### 6.1 文件结构

```
workspace/
├── AGENTS.md          # 工作空间说明 & 安全默认值
├── SOUL.md            # 人格定义
│                      # - 语气、风格
│                      # - 边界、禁止事项
│                      # - 默认语言
│
├── IDENTITY.md        # 身份信息
│                      # - 名字 (Owlia)
│                      # - Emoji (🦉)
│                      # - Vibe
│
├── USER.md            # 用户画像
│                      # - 偏好
│                      # - 时区
│                      # - 联系方式
│
├── HEARTBEAT.md       # Heartbeat 任务清单
│                      # - 定期执行的检查项
│
├── MEMORY.md          # 长期记忆
│                      # - 重要决策
│                      # - 用户偏好
│                      # - 技术方案
│
├── TOOLS.md           # 用户对工具的备注
│
└── memory/
    ├── diary/         # 每日日记 (YYYY-MM-DD.md)
    ├── weekly/        # 周总结 (YYYY-WNN.md)
    └── archive/       # 归档
```

### 6.2 System Prompt 构建

```typescript
// src/agent/system-prompt.ts

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];
  
  // 1. 基础角色
  sections.push(`You are a crypto-focused AI assistant running locally.`);
  
  // 2. SOUL.md - 人格定义
  const soul = loadWorkspaceFile("SOUL.md");
  if (soul) {
    sections.push(`## Persona & Boundaries\n${soul}`);
  }
  
  // 3. IDENTITY.md - 身份
  const identity = loadWorkspaceFile("IDENTITY.md");
  if (identity) {
    sections.push(`## Identity\n${identity}`);
  }
  
  // 4. USER.md - 用户画像
  const user = loadWorkspaceFile("USER.md");
  if (user) {
    sections.push(`## User Profile\n${user}`);
  }
  
  // 5. Tools 说明
  sections.push(`## Available Tools\n${formatToolsSection(ctx.tools)}`);
  
  // 6. Memory 使用说明
  sections.push(`## Memory Recall
Before answering questions about prior work, decisions, or preferences:
- Use memory_search to find relevant context
- Use memory_get to retrieve specific lines
`);
  
  // 7. Runtime 信息
  sections.push(`## Runtime
- Time: ${new Date().toISOString()}
- Timezone: ${ctx.timezone}
- Channel: ${ctx.channel}
- Model: ${ctx.model}
`);
  
  // 8. Heartbeat 说明（如果是 heartbeat 触发）
  if (ctx.isHeartbeat) {
    sections.push(`## Heartbeat
Read HEARTBEAT.md and execute the checklist.
If nothing needs attention, reply: HEARTBEAT_OK
`);
  }
  
  return sections.join("\n\n");
}
```

---

## 7. 依赖策略

### 7.1 依赖预算盘点

| 类别 | 依赖 | 数量 | 备注 |
|------|------|------|------|
| CLI/Config | `commander`, `zod`, `yaml` | 3 | 必须 |
| HTTP/日志 | `undici`, `tslog` | 2 | 必须 |
| 定时任务 | `croner` | 1 | 必须 |
| Channels | `grammy`, `discord.js` | 2 | 必须 |
| Crypto | `viem` | 1 | Phase 2+ |
| WebSocket | `ws` | 0-1 | App Bridge 可能需要 |
| LLM SDK | - | 0 | 用 undici 直接调 |
| 文件遍历 | - | 0 | Node 22 自带 fs.glob |
| 环境变量 | - | 0 | Node 20 自带 --env-file |
| **小计** | | **9-10** | |

**预算余量：~20 个**（可用于 4337 SDK、WalletConnect 等）

### 7.2 核心依赖详情

| 依赖 | 用途 | 可替代性 |
|------|------|----------|
| `commander` | CLI | 无 |
| `zod` | Schema 验证 | 可选 TypeBox |
| `grammy` | Telegram Bot | 无 |
| `discord.js` | Discord Bot | 无 |
| `croner` | Cron 调度 | 可选 node-cron |
| `tslog` | 日志 | 可选 pino |
| `yaml` | 配置解析 | 无 |
| `undici` | HTTP 客户端 | 可选 node 原生 |

### 7.3 AI Provider 策略

| 方案 | 依赖 | 说明 |
|------|------|------|
| **推荐** | 无（用 undici） | 直接调用 HTTP API，零额外依赖 |
| 备选 | `@anthropic-ai/sdk` | 类型安全，但增加依赖 |
| 备选 | `openai` | 支持 OpenAI 兼容 API |

### 7.4 Crypto 依赖（按需引入）

| 依赖 | 用途 | 引入时机 |
|------|------|----------|
| `viem` | 链上交互 | Phase 2: Tier 2 Session Key |
| `permissionless` | 4337 SDK | Phase 3: Tier 3 合约钱包 |
| `@walletconnect/sign-client` | WalletConnect | 如果需要连接外部钱包 |

### 7.5 目标

- **直接依赖**: < 20 个 ✅ (当前 ~10)
- **展开后总包数**: < 150 个
- **无 native 模块**（除非必要）
- **预算状态**: 充足 🟢

---

## 8. 开发路线

### Phase 1: 骨架 (1 周)

- [ ] 项目初始化 (TypeScript, ESM)
- [ ] CLI 入口 (commander)
- [ ] Config 加载 (zod schema)
- [ ] Workspace 加载器 (SOUL/IDENTITY/USER/MEMORY)
- [ ] Tool 接口定义
- [ ] Signer 接口定义
- [ ] Channel 接口定义

### Phase 2: 消息通道 (1 周)

- [ ] Telegram 渠道实现
- [ ] Discord 渠道实现
- [ ] 消息路由
- [ ] 权限检查 (allowlist)

### Phase 3: Agent 运行时 (1 周)

- [ ] System Prompt 构建
- [ ] LLM Runner (Anthropic/OpenAI)
- [ ] Tool Executor
- [ ] Session 管理
- [ ] Memory 搜索

### Phase 4: 定时任务 (3 天)

- [ ] Cron Service
- [ ] Heartbeat
- [ ] 任务持久化

### Phase 5: 签名层 (1 周)

- [ ] Session Key 实现 (Tier 2)
- [ ] App Bridge 协议定义 (Tier 1)
- [ ] Companion App 基础版

### Phase 6: 扩展 (持续)

- [ ] 更多 Tools
- [ ] 智能合约钱包集成 (Tier 3)
- [ ] 部署脚本
- [ ] 文档

---

## 附录

### A. 参考资料

- Clawdbot 架构分析: `reference/clawdbot-analysis.md`
- ERC-4337 Account Abstraction
- Safe{Wallet} Session Keys
- Biconomy Smart Accounts

### B. 设计决策记录

#### DR-001: Memory 搜索实现策略

**日期:** 2026-01-25

**问题:** Memory 语义搜索如何实现？
- Embedding 从哪来？(本地模型 / API 调用 / 简单关键词匹配?)
- 向量存储方式？(内存 / SQLite / 专用向量库?)
- 索引更新时机？

**选项:**
1. 核心功能 - Agent 依赖语义搜索回忆上下文
2. Nice-to-have - 先用简单关键词搜索，后续再加语义
3. 可以砍掉 - MVP 不需要

**决策:** 选择 **2. Nice-to-have**

**理由:**
- Crypto bot 场景下，语义搜索不是核心需求
- 价格/交易是实时查询，不需要记忆
- 钱包地址、策略参数写在配置里
- SOUL/IDENTITY 需要读取，但不需要"搜索"
- 历史决策回忆需要，但频率低

**实现:**
- MVP: glob 遍历 + includes 关键词匹配，无外部依赖
- 后续: 可插入 Embedding API + sqlite-vec，接口不变

---

#### DR-002: LLM Provider Failover 策略

**日期:** 2026-01-25

**问题:** 多 Provider 支持和 failover 机制如何实现？
- Failover 触发条件？
- 重试策略？
- Provider 优先级如何配置？

**选项:**
1. 简单线性 fallback - Provider A 失败就试 B
2. 智能路由 - 根据错误类型决定是重试还是切换
3. 单 Provider 就够 - MVP 先不做 failover

**决策:** 选择 **1. 简单线性 fallback**

**理由:**
- 比完全没有 failover 好
- 实现简单，MVP 阶段足够
- 后续可升级为智能路由

**实现:**
- 按 priority 排序 provider 列表
- 429/5xx/timeout → 切换下一个
- 401/403/400 → 直接抛出
- 所有 provider 失败 → 抛出最终错误

---

#### DR-003: Session 管理策略

**日期:** 2026-01-25

**问题:** Session 如何管理？
- Session 粒度？
- 上下文窗口策略？
- 持久化方式？

**选项（粒度）:**
1. Per user 全局 - 同一用户在 TG 和 Discord 共享上下文
2. Per channel-user - TG 和 Discord 分开
3. Per chat - 群聊私聊各自独立

**决策:** 选择 **2. Per channel-user**

**理由:**
- TG 和 Discord 可能用途不同
- 同平台内上下文应该连续
- 避免跨平台场景混淆

**实现:**
- Session Key: `${channel}:${peerId}`
- 窗口: 滑动窗口，保留最近 20 轮
- 持久化: JSONL 文件 (`~/.owliabot/sessions/`)
- 压缩: MVP 不做，后续可加 `/compact`

---

#### DR-004: Tool 确认流程

**日期:** 2026-01-25

**问题:** 非签名的 write 级别 Tool 如何确认？

**选项:**
1. Inline 确认 - Telegram/Discord 的按钮
2. 统一走 Transaction Page - 所有确认都跳转 web
3. MVP 不需要 - 先只做 read 和 sign 级别

**决策:** 选择 **1. Inline 确认**，但 MVP 阶段先不实现 write 操作

**理由:**
- Inline 按钮体验流畅，不离开聊天
- 签名操作已用 Transaction Page，其他用 inline 区分重要程度
- MVP 阶段 write 操作不多，可以后加

**实现:**
- `read`: 无需确认
- `write`: Inline 按钮确认（Phase 2）
- `sign`: Transaction Page / Companion App

**MVP 策略:**
- Phase 1: 只做 `read` + `sign`
- Phase 2: 加入 `write` + Inline 确认

---

#### DR-005: Heartbeat 通知通道

**日期:** 2026-01-25

**问题:** Heartbeat 主动推送发到哪个通道？用户可能同时用 TG 和 Discord。

**选项:**
1. 配置默认通道 - config.yaml 里指定
2. 发到最近活跃的通道 - 哪个最后收到消息就发哪个
3. 全部发 - TG 和 Discord 都发

**决策:** 选择 **1. 配置默认通道**

**理由:**
- 简单明确，用户可控
- 避免重复打扰（全部发）
- 避免发错地方（最近活跃可能不准）

**实现:**
```yaml
notifications:
  channel: telegram:883499266
```
- 如果没配置，fallback 到最近活跃的通道

---

#### DR-006: 群聊场景

**日期:** 2026-01-25

**问题:** 群聊场景如何处理？
- Bot 响应所有消息还是只响应 @mention？
- Session 共享还是 per-user？
- 谁可以在群里使用 Bot？

**选项:**
1. MVP 只做私聊 - 群聊暂不支持
2. 群聊也做，但限制触发 - 只响应 @mention，Session per-user
3. 群聊共享上下文 - 群成员共享对话历史

**决策:** 选择 **1. MVP 只做私聊**

**理由:**
- 交易/钱包操作必须私聊（隐私）
- 群聊增加复杂度（触发逻辑、权限、Session 粒度）
- 先做好私聊，后续按需加群聊

**实现:**
- `chatType === "direct"` → 处理
- `chatType === "group" | "channel"` → 忽略
- 后续可配置 `allowGroups`、`groupTrigger`、`groupSession`

---

#### DR-007: 认证方式

**日期:** 2026-01-26

**问题:** 如何获取 Anthropic API 认证？

**选项:**
1. Console API Key - 用户从 console.anthropic.com 获取
2. OAuth Setup Token - 通过 OAuth 流程，使用 Claude 订阅额度（需要申请 OAuth client_id）
3. 复用 Clawdbot Auth - 读取 clawdbot 的 auth-profiles.json
4. 复用 Claude CLI Token - 读取 Claude CLI 的 credentials

**决策:** 选择 **4. 复用 Claude CLI Token**

**理由:**
- Claude CLI 有 Anthropic 官方的 OAuth client_id，不需要自己申请
- 使用 Claude 订阅额度（Pro/Max），无需开发者账户
- 用户只需运行 `claude auth` 一次（Claude CLI 命令）
- Clawdbot 也是用这个方式

**Claude CLI Token 位置:**

```
~/.claude/.credentials.json
```

**Token 格式:**

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1769377803089,
    "scopes": ["user:inference", "user:profile", ...],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_20x"
  }
}
```

**实现:**

1. `src/auth/claude-cli.ts` - 读取 Claude CLI token：

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthToken } from "./store.js";

const CLAUDE_CLI_CREDENTIALS_PATH = join(
  process.env.HOME ?? "",
  ".claude",
  ".credentials.json"
);

export function loadClaudeCliToken(): AuthToken | null {
  try {
    const content = readFileSync(CLAUDE_CLI_CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(content);
    const oauth = data.claudeAiOauth;
    
    if (!oauth?.accessToken) return null;
    
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      tokenType: "Bearer",
    };
  } catch {
    return null;
  }
}

export function isClaudeCliAuthenticated(): boolean {
  const token = loadClaudeCliToken();
  return token !== null && Date.now() < token.expiresAt;
}
```

2. 修改 `src/agent/providers/claude-oauth.ts` 的 `getValidToken()`：

```typescript
import { loadClaudeCliToken } from "../../auth/claude-cli.js";

async function getValidToken(): Promise<AuthToken> {
  // 优先用 OwliaBot 自己的 token
  const store = getAuthStore();
  let token = await store.get();
  
  // Fallback 到 Claude CLI token
  if (!token) {
    token = loadClaudeCliToken();
    if (!token) {
      throw new Error(
        "Not authenticated. Run 'claude auth' (Claude CLI) first."
      );
    }
  }
  
  if (Date.now() >= token.expiresAt) {
    throw new Error(
      "Token expired. Run 'claude auth' to re-authenticate."
    );
  }
  
  return token;
}
```

3. 更新 `owliabot auth status` 命令，显示 Claude CLI token 状态：

```typescript
auth.command("status").action(async () => {
  // 检查 OwliaBot 自己的 token
  const ownToken = await store.get();
  
  // 检查 Claude CLI token
  const cliToken = loadClaudeCliToken();
  
  if (ownToken) {
    log.info("Using OwliaBot auth");
    // ...
  } else if (cliToken) {
    log.info("Using Claude CLI auth");
    log.info(`Expires at: ${new Date(cliToken.expiresAt).toISOString()}`);
  } else {
    log.info("Not authenticated. Run 'claude auth' first.");
  }
});
```

**API Endpoint:**

Claude CLI token 使用 `api.anthropic.com`（不是 `api.claude.ai`）：

```typescript
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// Headers
headers: {
  "Content-Type": "application/json",
  "x-api-key": token.accessToken,
  "anthropic-version": "2023-06-01",
}
```

**用户流程:**

1. 安装 Claude CLI: `npm install -g @anthropic-ai/claude-cli`
2. 登录: `claude auth`（打开浏览器授权）
3. 启动 OwliaBot: `owliabot start`（自动读取 Claude CLI token）

**可选：保留 `owliabot auth setup`**

如果后续申请了 OAuth client_id，可以启用自己的 OAuth flow，优先级高于 Claude CLI token。

---

#### DR-008: Provider 注册制

**日期:** 2026-01-26

**问题:** 如何方便地扩展新的 LLM provider？

**选项:**
1. 硬编码 switch - 当前实现，每次加 provider 改 runner.ts
2. 注册制 - Provider 自注册，runner 通过 registry 查找

**决策:** 选择 **2. 注册制**

**理由:**
- 解耦 runner 和具体 provider 实现
- 新增 provider 无需改 runner 代码
- 方便后续支持 OpenAI、OpenRouter、本地模型等

**实现:**
```typescript
// 注册
providerRegistry.register("anthropic", callAnthropic);
providerRegistry.register("openai", callOpenAI);

// 使用
const fn = providerRegistry.get(provider.id);
return fn(config, messages, options);
```

---

(更多决策待补充)
