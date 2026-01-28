# OwliaBot - Crypto-Native AI Agent

> 为 Crypto 用户设计的 Self-Hosted AI Agent，安全优先，本地运行。

---

## 目录

1. [设计理念](#1-设计理念)
   - [1.1 核心原则](#11-核心原则)
   - [1.2 与 Clawdbot 的关系](#12-与-clawdbot-的关系)
2. [安全模型](#2-安全模型)
   - [2.1 密钥分层架构](#21-密钥分层架构)
   - [2.2 安全原则](#22-安全原则)
   - [2.3 连接身份--配对模型](#23-连接身份--配对模型)
3. [架构总览](#3-架构总览)
   - [3.1 架构图](#31-架构图)
   - [3.2 消息处理流程](#32-消息处理流程)
   - [3.3 能力扩展模型](#33-能力扩展模型)
4. [模块设计](#4-模块设计)
   - [4.1 目录结构](#41-目录结构)
   - [4.2 模块职责](#42-模块职责)
   - [4.3 Gateway（控制平面）职责与协议定义](#43-gateway控制平面职责与协议定义)
5. [接口定义](#5-接口定义)
   - [5.1 Channel 接口](#51-channel-接口)
   - [5.2 Tool 接口](#52-tool-接口)
   - [5.3 Signer 接口](#53-signer-接口)
   - [5.4 Memory 接口](#54-memory-接口)
   - [5.5 LLM Runner 接口（使用 pi-ai）](#55-llm-runner-接口使用-pi-ai)
   - [5.6 Session 接口](#56-session-接口)
   - [5.7 Notifications 接口](#57-notifications-接口)
   - [5.8 Auth 接口](#58-auth-接口)
   - [5.9 Runtime 事件与可观测性](#59-runtime-事件与可观测性)
6. [工作空间](#6-工作空间)
   - [6.1 文件结构](#61-文件结构)
   - [6.2 System Prompt 构建](#62-system-prompt-构建)
7. [依赖策略](#7-依赖策略)
   - [7.1 依赖预算盘点](#71-依赖预算盘点)
   - [7.2 核心依赖详情](#72-核心依赖详情)
   - [7.3 AI Provider 策略](#73-ai-provider-策略)
   - [7.4 Crypto 依赖（按需引入）](#74-crypto-依赖按需引入)
   - [7.5 目标](#75-目标)
8. [开发路线](#8-开发路线)
   - [Phase 1: 骨架 (1 周)](#phase-1-骨架-1-周)
   - [Phase 2: 消息通道 (1 周)](#phase-2-消息通道-1-周)
   - [Phase 3: Agent 运行时 (1 周)](#phase-3-agent-运行时-1-周)
   - [Phase 4: 定时任务 (3 天)](#phase-4-定时任务-3-天)
   - [Phase 5: 签名层 (1 周)](#phase-5-签名层-1-周)
   - [Phase 6: 扩展 (持续)](#phase-6-扩展-持续)
   - [Phase 7: Skills 系统](#phase-7-skills-系统)

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

### 2.3 连接身份 / 配对模型

为避免控制平面被冒用，连接需要有明确的“谁在连接、如何建立信任、如何撤销”的边界定义。

#### 2.3.1 身份载荷（控制平面 / 客户端 / 节点）

- **控制平面连接**: 由 Bot/Core 发起与 Companion App 或控制端的连接时，身份载荷至少包含 `device_id`、`user_id`、`session_key_pub`、`capabilities`、`tool_level`（与工具安全级别同步）。  
- **客户端连接**: Telegram/Discord 等渠道端口连接时，身份载荷绑定 `channel_id`、`account_id`、`channel_scopes`，用于限定能触发的功能范围。  
- **节点连接（若存在）**: 多设备/多节点场景下，节点身份载荷包含 `node_id`、`node_pubkey`、`role`（如执行/观察/备份），并与控制平面授权策略对齐。  

#### 2.3.2 本地连接 vs 远程连接的信任策略

- **本地连接**: 默认信任强度更高，可用静态配对密钥 + 本地网络白名单；仍需执行一次性挑战来避免旁路连接。  
- **远程连接**: 必须开启双向验证（签名挑战或 token 轮换），并按 `tool_level` 绑定最小权限与到期时间；必要时强制二次确认（Tier 1）。  

#### 2.3.3 连接 token 与挑战验证（可选）

- **连接 token**: 由控制平面签发短期 token（含 `aud`、`exp`、`scope`），仅允许建立连接或执行特定 Tool。  
- **挑战验证**: 远程连接可要求 `nonce + timestamp` 的签名挑战，验证 `session_key_pub` 是否持有；失败则拒绝连接并记录审计。  

#### 2.3.4 审计 / 撤销与白名单策略（与 Tool 安全级别并行）

- **审计**: 每次连接建立、权限提升、敏感 Tool 调用均写入审计日志，关联 `device_id`/`node_id`/`channel_id`。  
- **撤销**: 支持对 `session_key`、设备、节点、渠道账号的撤销；撤销后所有连接 token 失效并要求重新配对。  
- **白名单**: Tool 白名单与连接身份绑定（按 `tool_level`），仅允许被批准的设备/节点/渠道触发相应级别操作。  

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

### 3.3 能力扩展模型

能力扩展由三层宿主体系支撑，既能接入 MCP/Playwright，又保持安全与执行上下文一致：

| 宿主层级 | 责任 | MCP/Playwright 位置 |
|---------|------|--------------------|
| **Gateway** | 统一入口、鉴权、连接管理 | MCP Server Registry / Playwright 远程连接配置 |
| **Agent Runtime** | 能力编排、工具选择、上下文注入 | MCP Client 适配层、Playwright session 生命周期 |
| **Tool Executor** | 实际执行、权限校验、结果回传 | MCP Tool Adapter、Playwright Action 执行 |

**注册/发现机制（Capability Registry）**
- **注册方式**：启动时读取本地 `capability registry`（YAML/JSON）+ 运行时动态注册（MCP server 自描述 / Tool manifest）。  
- **发现方式**：Agent Runtime 按 `capability.id` / `category` / `security.level` 查询，并将可用工具注入 System Prompt。  
- **能力元数据**：`name`、`description`、`security.level`、`requiredContext`、`runtime`（如 `mcp://`、`playwright://`）。  
- **热更新**：Gateway 接收变更事件，刷新 registry，并通知 Agent Runtime 重新构建工具清单。  

**权限与执行上下文统一策略（与 read/write/sign 对齐）**
- **统一权限标签**：所有能力（含 MCP/Playwright）必须声明 `security.level = read | write | sign`，Tool Executor 统一做权限门禁。  
- **上下文映射**：由 Agent Runtime 生成 `ExecutionContext`，包含 `sessionKey`、`agentId`、`userId`、`channel`、`limits`，传递至 Tool Executor/MCP/Playwright。  
- **确认链路一致**：`write` 走 inline 确认，`sign` 走交易确认/Companion App，与现有确认流程保持一致。  
- **审计与回滚**：执行结果（request/response、权限级别、上下文摘要）统一记录，支持审计与可追溯撤销。  

**Playwright MCP 集成（v1 约束）**
- **接入形态**：Playwright 以独立 MCP Server 进程注册到 Gateway（`capabilityId = mcp.playwright`）。  
- **调用路径**：`Client → Gateway /command/mcp → Tool Executor → MCP Adapter → Playwright MCP`。  
- **动作级权限**：read（`goto`/`wait_for`/`screenshot`/`get_content`/`query`），write（`click`/`type`/`select`/`download`/`upload`/`close`）。  
- **安全策略**：不强制 sandbox；启用动作白名单；默认允许任意域名（后续可加 allow/deny）；下载与上传允许但目录受控（按 `sessionId`）。  

**系统能力层（exec/web fetch/search）**
- **统一形态**：SystemCapability（与 MCP 能力一致，统一注册/调用/审计）。  
- **调用路径**：`Client → Gateway /command/system → Tool Executor → SystemCapability`。  
- **动作级权限**：`exec = write`，`web.fetch = read`，`web.search = read`。  
- **安全策略**：exec 需命令白名单 + 工作目录限制 + 环境变量隔离；web fetch/search 需域名策略 + 超时 + 最大响应；允许 POST 但必须做敏感信息审查。  

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

### 4.3 Gateway（控制平面）职责与协议定义

#### 定位与统一入口策略

- **默认策略（v1）**：Gateway 作为**控制平面**，对外保持**轻量 HTTP**（健康检查、状态、运行指标、命令调用），对内通过**内部总线**治理调用与事件分发。  
- **兼容策略（v2 预留）**：若需要对接类似 Moltbot WS API 的统一入口，可启用 **WS/IPC** 作为**统一入口协议**，但仍复用同一套内部协议与治理规则。  
- **结论**：Gateway 不是“单体业务入口”，而是**统一控制与调度入口**；所有跨模块请求都必须进入 Gateway 协议面，避免旁路。

#### 控制平面职责

1. **统一入口**：聚合来自 CLI / Channel / 定时任务 / 系统能力层的请求。
2. **路由与治理**：基于策略将请求转发到 Agent Runtime、Tool Executor、MCP、System Capability。
3. **审计与追踪**：记录请求链路（requestId、sessionKey、actor、traceId）。
4. **幂等与重试**：在协议层处理幂等键与重试策略。
5. **安全校验**：统一鉴权、签名验证、权限校验、速率限制。

#### 统一协议（v2 预留：WS/IPC/Bus 共享）

> 统一协议用于 WS / IPC / 内部总线三种通道的消息格式与语义，确保“入口一致、治理一致、路径一致”。HTTP v1 仍是当前默认入口。

**1) connect 握手**

```json
{
  "type": "connect",
  "requestId": "uuid",
  "ts": 1710000000,
  "client": {
    "id": "gateway-client-id",
    "kind": "cli|channel|cron|system",
    "version": "x.y.z"
  },
  "auth": {
    "scheme": "token|sig|local",
    "token": "opaque-or-jwt",
    "signature": "optional",
    "nonce": "random"
  },
  "capabilities": ["req", "event"]
}
```

**握手响应：**

```json
{
  "type": "connect_ack",
  "requestId": "uuid",
  "ok": true,
  "sessionId": "gw-session-id",
  "server": { "version": "x.y.z" }
}
```

**2) 请求/响应结构（req/res）**

```json
{
  "type": "req",
  "requestId": "uuid",
  "ts": 1710000000,
  "actor": {
    "id": "telegram:883499266",
    "role": "user|system|service"
  },
  "sessionKey": "telegram:883499266",
  "route": "agent.run|tool.exec|mcp.call|sys.capability",
  "idempotencyKey": "optional-hash",
  "payload": { "any": "data" },
  "security": {
    "level": "read|write|sign",
    "scopes": ["wallet:read"],
    "signature": "optional"
  },
  "trace": { "traceId": "uuid", "spanId": "uuid" }
}
```

```json
{
  "type": "res",
  "requestId": "uuid",
  "ok": true,
  "ts": 1710000001,
  "data": { "any": "result" },
  "error": {
    "code": "ERR_PERMISSION_DENIED",
    "message": "..."
  }
}
```

**3) 事件结构（event）**

```json
{
  "type": "event",
  "eventId": "uuid",
  "ts": 1710000002,
  "eventType": "agent.output|tool.progress|mcp.event|system.alert|session.update",
  "sessionKey": "telegram:883499266",
  "payload": { "any": "data" },
  "trace": { "traceId": "uuid", "spanId": "uuid" }
}
```

#### 事件类型（最小集合）

- `agent.output`：LLM 输出片段/最终回复
- `tool.progress`：工具执行进度/日志
- `tool.result`：工具执行结果
- `mcp.event`：MCP Server 事件
- `system.alert`：告警/异常
- `session.update`：会话状态变化

#### 幂等键与安全校验

- **幂等键（idempotencyKey）**：
  - 由调用方生成（如 `hash(route + payload + sessionKey)`）。
  - Gateway 维护短期缓存（TTL）防止重复执行。
  - `tool.exec` 与 `mcp.call` 强制要求幂等键。
- **安全校验**：
  - 校验 `auth.scheme` 与 `token/signature`；
  - 校验 `security.level` 与 `scopes`；
  - 对 `sign` 级别请求强制二次确认与审计记录。

#### 统一调用路径（禁止旁路）

- **工具执行 / MCP / 系统能力层** 必须通过 Gateway 协议面调用：  
  `Channel/CLI/Cron/System → Gateway (req) → Router → Tool Executor/MCP/System Capability → Gateway (res/event)`  
- 不允许直接调用 Tool/MCP/System 的旁路路径，所有调用必须具备 `requestId`、`traceId`、`idempotencyKey` 与安全校验。

#### Gateway 职责边界

- **入口路由为主**：Gateway 负责接收外部 HTTP/Channel 请求、做基础的协议解析与路由分发，不直接参与业务逻辑执行。
- **权限检查只做“粗粒度入口保护”**：Gateway 可以进行基础 allowlist/速率限制/IP 级别的保护，但**不承担最终授权决策**。最终授权由 Tool Executor 根据上下文与安全等级完成。
- **最小知识原则**：Gateway 不需要理解具体 Tool 的权限规则，只需保证请求合法性与基础认证（如 webhook 签名、token 校验）。

#### Tool Executor 与 Gateway 的授权链路

1. **Gateway 接入并校验来源**（可选：channel allowlist、webhook 签名、token 验证）。
2. **Gateway 构造 MsgContext 并转交 Agent Runtime**，附带可用的身份/会话信息（sender、channel、groupId 等）。
3. **Tool Executor 执行细粒度授权**：
   - 基于 Tool 元数据（read/write/sign）做安全等级判定。
   - 基于 Session / allowlist / tool policy 做权限过滤。
4. **需要签名的调用进入 Signer Layer**，按 Tier 规则继续校验（用户确认或 session key 限额）。

> 结论：Gateway 是“入口守门”，Tool Executor 是“权限裁判 + 执行者”。

#### 安全等级（read / write / sign）的校验点与审计点

| 安全等级 | 校验点 | 审计点 |
|---------|--------|--------|
| **read** | Tool Executor：检查上下文权限、allowlist、工具是否只读 | Tool Executor：记录调用参数摘要与结果摘要 |
| **write** | Tool Executor：权限 + 速率/资源限制；如需用户确认则触发确认流程 | Tool Executor：记录变更前后状态或操作摘要 |
| **sign** | Tool Executor → Signer：双重校验（Tool 规则 + Tier 规则） | Tool Executor & Signer：记录签名请求、用户确认与签名结果 |

**审计统一原则：**
- 所有工具调用都在 Tool Executor 侧统一记录审计日志。
- Signer 侧追加“签名级别审计”，含用户确认、签名 payload hash、广播结果。

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

#### Telegram 消息格式化

Telegram 支持的 HTML 标签有限：`<b>`, `<i>`, `<code>`, `<pre>`, `<a>`, `<u>`, `<s>`

**不支持：** headers (`#`), lists (`-`), tables

**实现策略：** Markdown → Telegram HTML 转换

```typescript
// src/channels/telegram/index.ts

function markdownToTelegramHtml(text: string): string {
  let html = text;
  
  // Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  
  // Headers -> Bold
  html = html.replace(/^### (.+)$/gm, "\n<b>$1</b>");
  html = html.replace(/^## (.+)$/gm, "\n<b>$1</b>");
  html = html.replace(/^# (.+)$/gm, "\n<b>$1</b>\n");
  
  // Horizontal rules
  html = html.replace(/^---+$/gm, "───────────");
  
  // Code blocks & inline code
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, "<pre>$2</pre>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  
  // Bold, Italic, Strikethrough
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // List items -> bullet
  html = html.replace(/^- (.+)$/gm, "• $1");
  
  return html.trim();
}
```

**Fallback：** 如果 HTML 解析失败，自动降级为纯文本发送。

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

### 5.5 LLM Runner 接口（使用 pi-ai）

#### 决策：使用 @mariozechner/pi-ai

**理由：**
- 多 provider 支持开箱即用（Anthropic, OpenAI, Google, Bedrock, Mistral）
- 统一的 streaming API
- Tool calling 已经处理好
- OAuth 认证和刷新自动处理
- 与 Clawdbot 使用相同的底层库

**pi-ai 依赖：**
```
@anthropic-ai/sdk     → Anthropic Claude
openai                → OpenAI / OpenRouter  
@google/genai         → Gemini
@aws-sdk/...          → Bedrock
@mistralai/...        → Mistral
```

#### 配置示例

```yaml
# config.yaml
model:
  provider: anthropic
  id: claude-sonnet-4-5
  
# 或使用完整的 model id
model: anthropic/claude-sonnet-4-5

# OAuth 认证（通过 owliabot auth setup）
# Token 保存在 ~/.owliabot/auth.json
```

#### 接口定义

```typescript
// src/agent/runner.ts

import { stream, complete, getEnvApiKey } from "@mariozechner/pi-ai";
import { getOAuthApiKey, loginAnthropic, refreshAnthropicToken } from "@mariozechner/pi-ai/utils/oauth";
import type { Model, Context, AssistantMessage } from "@mariozechner/pi-ai";

export interface RunnerOptions {
  model: Model;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  reasoning?: "minimal" | "low" | "medium" | "high";
}

/**
 * 调用 LLM，返回完整响应
 */
export async function runLLM(
  context: Context,
  options: RunnerOptions
): Promise<AssistantMessage> {
  const apiKey = await resolveApiKey(options.model.provider);
  
  return complete(options.model, context, {
    apiKey,
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature,
    reasoning: options.reasoning,
  });
}

/**
 * 调用 LLM，返回 streaming 响应
 */
export function streamLLM(
  context: Context,
  options: RunnerOptions
): AssistantMessageEventStream {
  const apiKey = await resolveApiKey(options.model.provider);
  
  return stream(options.model, context, {
    apiKey,
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature,
    reasoning: options.reasoning,
  });
}

/**
 * 解析 API Key（支持 OAuth token）
 */
async function resolveApiKey(provider: string): Promise<string> {
  // 1. 检查环境变量
  const envKey = getEnvApiKey(provider);
  if (envKey) return envKey;
  
  // 2. 检查 OAuth credentials
  if (provider === "anthropic") {
    const credentials = await loadOAuthCredentials();
    if (credentials) {
      const result = await getOAuthApiKey("anthropic", { anthropic: credentials });
      if (result) {
        // 如果 token 被刷新，保存新的 credentials
        if (result.newCredentials !== credentials) {
          await saveOAuthCredentials(result.newCredentials);
        }
        return result.apiKey;
      }
    }
  }
  
  throw new Error(`No API key for provider: ${provider}. Run 'owliabot auth setup'.`);
}
```

#### Model 解析

```typescript
// src/agent/models.ts

import { ANTHROPIC_MODELS, OPENAI_MODELS, GOOGLE_MODELS } from "@mariozechner/pi-ai";

export function resolveModel(modelId: string): Model {
  // 支持 provider/model 格式
  if (modelId.includes("/")) {
    const [provider, id] = modelId.split("/", 2);
    return getModelByProviderAndId(provider, id);
  }
  
  // 支持别名
  const aliases: Record<string, string> = {
    "sonnet": "anthropic/claude-sonnet-4-5",
    "opus": "anthropic/claude-opus-4-5",
    "gpt-4o": "openai/gpt-4o",
    "gemini": "google/gemini-2.5-pro",
  };
  
  if (aliases[modelId]) {
    return resolveModel(aliases[modelId]);
  }
  
  // 默认 Anthropic
  return ANTHROPIC_MODELS[modelId] ?? ANTHROPIC_MODELS["claude-sonnet-4-5"];
}
```

#### Tool Calling

pi-ai 内置了 tool calling 支持：

```typescript
// 使用 pi-ai 的 tool 格式
const tools = [
  {
    name: "get_price",
    description: "Get current price for a token",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Token symbol" }
      },
      required: ["symbol"]
    }
  }
];

const result = await complete(model, context, {
  apiKey,
  tools,
});

// 检查 tool calls
if (result.toolCalls) {
  for (const call of result.toolCalls) {
    const toolResult = await executeTool(call.name, call.input);
    // 继续对话...
  }
}
```

#### OAuth 集成

pi-ai 提供了完整的 OAuth 支持：

```typescript
// src/auth/anthropic.ts

import { loginAnthropic, refreshAnthropicToken } from "@mariozechner/pi-ai/utils/oauth";

export async function setupAuth(): Promise<void> {
  const credentials = await loginAnthropic(
    // 打开浏览器
    (url) => {
      console.log("Opening browser:", url);
      open(url);
    },
    // 等待用户输入授权码
    async () => {
      return await promptForCode("Paste authorization code: ");
    }
  );
  
  await saveOAuthCredentials(credentials);
}

export async function refreshAuth(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  return refreshAnthropicToken(credentials.refresh);
}
```

#### 简化的目录结构

使用 pi-ai 后，可以删除：
- `src/agent/providers/` 整个目录（pi-ai 内置）
- `src/agent/runner.ts` 大幅简化

```
src/agent/
├── runner.ts         # 简化版，调用 pi-ai
├── models.ts         # Model 解析和别名
├── session.ts        # Session 管理（不变）
├── system-prompt.ts  # System Prompt 构建（不变）
└── tools/
    ├── interface.ts  # Tool 接口（不变）
    ├── registry.ts   # Tool 注册（不变）
    └── executor.ts   # Tool 执行（不变）
```

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

### 5.9 Runtime 事件与可观测性

运行态会产生统一的 **RuntimeEvent**，用于健康检查、心跳、定时任务以及 Agent/Tool 执行轨迹的观测与告警。

#### 5.9.1 事件类型

| 类型 | 触发来源 | 典型用途 |
|------|----------|----------|
| `health` | HTTP 健康检查 | 服务存活、版本、依赖状态 |
| `heartbeat` | Heartbeat 调度 | 日常巡检、轻量自检 |
| `cron` | Cron 调度 | 定时任务执行、报告 |
| `agent` | Agent runtime | 对话生命周期、推理阶段、错误 |
| `tool` | Tool executor | 工具调用、输入输出摘要、耗时 |

#### 5.9.2 事件模型（建议）

```ts
export type RuntimeEventType = "health" | "heartbeat" | "cron" | "agent" | "tool";

export interface RuntimeEvent {
  id: string;                 // 唯一事件 ID
  type: RuntimeEventType;
  time: string;               // ISO8601
  status: "ok" | "warn" | "error";
  source: string;             // module 或 component 名
  message?: string;           // 简要描述
  durationMs?: number;        // 可选：执行耗时
  metadata?: Record<string, unknown>; // 可选：结构化补充字段
}
```

#### 5.9.3 对外暴露方式

| 暴露方式 | 说明 | 适用事件 |
|----------|------|----------|
| HTTP | `/health` / `/events/poll` | `health` + 最近事件 |
| WebSocket（v2 预留） | `/ws/events` | `heartbeat/cron/agent/tool` 流式推送 |
| 日志 | JSON 日志（stdout/file） | 所有事件 |

**HTTP 示例：**

```json
// GET /health
{
  "status": "ok",
  "version": "0.1.0",
  "time": "2025-01-01T00:00:00.000Z"
}
```

```json
// GET /events/poll?limit=50&type=tool
{
  "items": [
    {
      "id": "evt_123",
      "type": "tool",
      "time": "2025-01-01T00:00:00.000Z",
      "status": "ok",
      "source": "tool.executor",
      "message": "fetch_price",
      "durationMs": 120
    }
  ]
}
```

#### 5.9.4 客户端/监控系统的消费方式

- **简单场景**：通过 `GET /health` 进行存活探测；使用 `GET /events/poll` 拉取最近事件（轮询）。
- **实时场景（v2 预留）**：前端或运维面板通过 `WS /ws/events` 订阅事件流，实时显示状态。
- **日志管道**：使用 JSON 日志输出到 stdout/file，由 Fluent Bit / Vector / Loki / ELK 采集。

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
| HTTP/日志 | `tslog` | 1 | 必须 |
| 定时任务 | `croner` | 1 | 必须 |
| Channels | `grammy`, `discord.js` | 2 | 必须 |
| **LLM** | `@mariozechner/pi-ai` | 1 | 核心（带 11 个子依赖） |
| Crypto | `viem` | 1 | Phase 2+ |
| 文件遍历 | - | 0 | Node 22 自带 fs.glob |
| 环境变量 | - | 0 | Node 20 自带 --env-file |
| **小计** | | **9** | |

**pi-ai 带来的子依赖（自动安装）：**
- `@anthropic-ai/sdk` - Anthropic Claude
- `openai` - OpenAI / OpenRouter
- `@google/genai` - Google Gemini
- `@aws-sdk/client-bedrock-runtime` - AWS Bedrock
- `@mistralai/mistralai` - Mistral
- 其他工具库

### 7.2 核心依赖详情

| 依赖 | 用途 | 可替代性 |
|------|------|----------|
| `@mariozechner/pi-ai` | LLM 调用 | 无（核心） |
| `commander` | CLI | 无 |
| `zod` | Schema 验证 | 可选 TypeBox |
| `grammy` | Telegram Bot | 无 |
| `discord.js` | Discord Bot | 无 |
| `croner` | Cron 调度 | 可选 node-cron |
| `tslog` | 日志 | 可选 pino |
| `yaml` | 配置解析 | 无 |

### 7.3 AI Provider 策略

| 方案 | 依赖 | 说明 |
|------|------|------|
| **采用** | `@mariozechner/pi-ai` | 统一 API，多 provider 支持，OAuth 内置 |

**pi-ai 支持的 Provider：**
- Anthropic (Claude) ✅ OAuth 支持
- OpenAI ✅
- Google Gemini ✅ OAuth 支持
- AWS Bedrock ✅
- Mistral ✅
- OpenRouter ✅
- GitHub Copilot ✅ OAuth 支持

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

### Phase 7: Skills 系统

通过 Skills 扩展 OwliaBot 功能，无需修改核心代码。

**核心设计决策：**
- 执行方式：JS Module (dynamic import)，简单高效
- 隔离方式：Docker 双容器架构，Skill 无法访问私钥
- 通信方式：localhost HTTP + JSON-RPC
- 认证方案：分阶段（本地信任 → 仓库信任 → 代码签名）

**详细设计：** `docs/architecture/skills-system.md`

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
2. OAuth Setup Token - 自己实现 OAuth 流程（需要申请 client_id）
3. 复用 Clawdbot Auth - 读取 clawdbot 的 auth-profiles.json
4. 复用 Claude CLI Token - 读取 Claude CLI 的 credentials ❌
5. 使用 pi-ai 的 OAuth 参数 - 复用 Clawdbot/pi-ai 的 OAuth client_id 和 scopes

**决策:** 选择 **5. 使用 pi-ai 的 OAuth 参数**

**理由:**
- Claude CLI token 有 `user:sessions:claude_code` scope 限制，**只能用于 Claude Code**
- pi-ai（Clawdbot 底层库）的 OAuth 使用不同的 scopes，可用于普通 API 请求
- 使用 Claude 订阅额度（Pro/Max），无需开发者账户
- 与 Clawdbot 完全相同的认证机制

**为什么 Claude CLI token 不能用：**

```
Claude CLI scopes:  user:inference, user:sessions:claude_code, ...
pi-ai scopes:       org:create_api_key, user:profile, user:inference

API 返回错误：
"This credential is only authorized for use with Claude Code 
and cannot be used for other API requests."
```

**pi-ai OAuth 参数（从 Clawdbot 提取）：**

```typescript
// src/auth/oauth.ts

// pi-ai 的 client_id（base64 解码）
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

// OAuth URLs
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";

// 关键：这些 scopes 可以用于普通 API 请求
const SCOPES = "org:create_api_key user:profile user:inference";
```

**OAuth Flow 实现：**

```typescript
// src/auth/oauth.ts

import { generatePKCE } from "./pkce.js";

export async function loginAnthropic(
  onAuthUrl: (url: string) => void,
  onPromptCode: () => Promise<string>
): Promise<AuthToken> {
  const { verifier, challenge } = await generatePKCE();

  // Build authorization URL
  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });

  const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;
  onAuthUrl(authUrl);

  // Wait for user to paste authorization code (format: code#state)
  const authCode = await onPromptCode();
  const [code, state] = authCode.split("#");

  // Exchange code for tokens
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    tokenType: "Bearer",
  };
}

export async function refreshAnthropicToken(refreshToken: string): Promise<AuthToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    tokenType: "Bearer",
  };
}
```

**PKCE 实现：**

```typescript
// src/auth/pkce.ts

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(43);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64UrlEncode(digest);
  return { verifier, challenge };
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

**API 调用：**

```typescript
// src/agent/providers/claude-oauth.ts

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// 使用 Bearer token + anthropic-beta header
headers: {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${token.accessToken}`,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "oauth-2025-04-20",
}
```

**CLI 命令：**

```bash
# 交互式设置（打开浏览器授权）
owliabot auth setup
# 1. 打开浏览器 → claude.ai/oauth/authorize
# 2. 用户登录并授权
# 3. 复制授权码（格式：code#state）粘贴到终端
# 4. 保存 token 到 ~/.owliabot/auth.json

# 查看状态
owliabot auth status

# 登出
owliabot auth logout
```

**用户流程：**

1. 运行 `owliabot auth setup`
2. 浏览器打开 Claude.ai 授权页面
3. 登录并授权
4. 复制页面上的授权码，粘贴到终端
5. 启动 `owliabot start`

---

#### DR-008: LLM 调用层

**日期:** 2026-01-26

**问题:** 如何支持多个 LLM provider？

**选项:**
1. 硬编码 switch - 每次加 provider 改 runner.ts
2. 自己的注册制 - Provider 自注册，runner 通过 registry 查找
3. 使用 pi-ai 库 - 统一 API，多 provider 支持

**决策:** 选择 **3. 使用 pi-ai 库**

**理由:**
- 多 provider 支持开箱即用（Anthropic, OpenAI, Google, Bedrock, Mistral）
- 统一的 streaming API
- Tool calling 已经处理好
- OAuth 认证和刷新自动处理
- 与 Clawdbot 使用相同的底层库
- 减少自己维护的代码量

**实现:**
```typescript
import { stream, complete } from "@mariozechner/pi-ai";
import { getOAuthApiKey } from "@mariozechner/pi-ai/utils/oauth";

// 调用任意 provider
const result = await complete(model, context, { apiKey });
```

---

#### DR-009: Telegram 消息格式化

**日期:** 2026-01-26

**问题:** LLM 输出的 Markdown 在 Telegram 显示为原始文本

**选项:**
1. 使用 `parse_mode: "Markdown"` - Telegram 原生 Markdown（语法严格，易出错）
2. 使用 `parse_mode: "MarkdownV2"` - 需要大量转义
3. 转换为 HTML - Telegram HTML 支持更稳定

**决策:** 选择 **3. 转换为 HTML**

**理由:**
- Telegram 原生 Markdown 对特殊字符非常敏感，稍有不慎就解析失败
- HTML 解析更宽容，失败率低
- 可以自定义转换规则（如 `##` → `<b>`，`-` → `•`）

**实现:**
- `markdownToTelegramHtml()` 函数处理转换
- 解析失败时 fallback 到纯文本
- 详见 Section 5.1 "Telegram 消息格式化"

---

#### DR-010: Workspace 路径解析

**日期:** 2026-01-26

**问题:** `config.yaml` 中的 `workspace: ./workspace` 相对路径在不同 cwd 下行为不一致

**决策:** 在 config loader 中将 workspace 路径解析为相对于 config 文件的绝对路径

**实现:**
```typescript
// src/config/loader.ts
import { resolve, dirname } from "node:path";

// 加载 config 后
const configDir = dirname(resolve(path));
config.workspace = resolve(configDir, config.workspace);
```

**效果:**
- `./workspace` 始终相对于 `config.yaml` 所在目录
- 无论从哪个目录运行 `owliabot start`，都能正确找到 workspace

---

(更多决策待补充)
