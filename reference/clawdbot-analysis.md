# Clawdbot 项目架构深度分析报告

> **分析日期:** 2026-01-15  
> **版本:** 2026.1.14  
> **源码仓库:** https://github.com/clawdbot/clawdbot  
> **本地源码:** `~/Codes/clawdbot-fork` (zhixian 的 fork，可直接访问)  
> **源码规模:** 1,279 个 TypeScript 源文件 (不含测试)，约 268,658 行代码  
> **分析方法:** TypeScript 源码阅读 (`src/` 目录)

---

## 目录

1. [架构总览](#1-架构总览)
2. [模块结构](#2-模块结构)
3. [消息处理流程](#3-消息处理流程)
4. [Agent 系统](#4-agent-系统)
5. [Channel/Plugin 机制](#5-channelplugin-机制)
6. [Heartbeat 和 Cron 机制](#6-heartbeat-和-cron-机制)
7. [Skills 系统](#7-skills-系统)
8. [Session 管理](#8-session-管理)
9. [Browser/Canvas 扩展](#9-browsercanvas-扩展)
10. [其他重要机制](#10-其他重要机制)

---

## 1. 架构总览

### 1.1 架构图 (Mermaid)

```mermaid
graph TB
    subgraph "入口层 Entry Layer"
        CLI[CLI 命令行<br/>clawdbot]
        Entry[src/entry.ts]
        Program[src/cli/program.ts]
    end

    subgraph "网关层 Gateway Layer"
        GW[Gateway Server<br/>src/gateway/server.impl.ts]
        WS[WebSocket Server]
        HTTP[HTTP Server]
        Bridge[Bridge Server<br/>Node 通信]
        CtrlUI[Control UI<br/>Web 管理界面]
    end

    subgraph "渠道层 Channel Layer"
        PluginReg[Channel Plugin Registry<br/>src/channels/plugins/index.ts]
        TG[Telegram<br/>grammY]
        WA[WhatsApp<br/>Baileys]
        DC[Discord<br/>discord.js]
        SL[Slack<br/>Bolt]
        SG[Signal<br/>signal-cli]
        IM[iMessage<br/>imsg CLI]
        MS[MS Teams<br/>Bot Framework]
    end

    subgraph "Agent 运行时 Agent Runtime"
        PI[Pi Embedded Runner<br/>src/agents/pi-embedded-runner/]
        PiCore[@mariozechner/pi-coding-agent]
        Tools[Tools 工具集<br/>src/agents/tools/]
        Skills[Skills 技能系统<br/>src/agents/skills/]
        SysPrompt[System Prompt Builder<br/>src/agents/system-prompt.ts]
    end

    subgraph "会话层 Session Layer"
        SM[Session Manager]
        SS[Session Store<br/>~/.clawdbot/sessions/*.json]
        MW[Memory & Workspace<br/>src/memory/]
    end

    subgraph "自动化层 Automation Layer"
        Cron[Cron Service<br/>src/cron/service.ts]
        HB[Heartbeat Runner<br/>src/infra/heartbeat-runner.ts]
        Hooks[Hooks<br/>Gmail Pub/Sub, Webhook]
    end

    subgraph "扩展层 Extension Layer"
        Browser[Browser Control<br/>src/browser/ (Playwright)]
        Canvas[Canvas Host<br/>src/canvas-host/ (A2UI)]
        Nodes[Mobile Nodes<br/>iOS/Android/macOS]
    end

    subgraph "基础设施 Infrastructure"
        Config[Config System<br/>src/config/]
        Logging[Logging<br/>src/logging/]
        Plugins[Plugin System<br/>src/plugins/]
        Providers[AI Providers<br/>src/providers/]
    end

    CLI --> Entry
    Entry --> Program
    Program --> GW

    GW --> WS
    GW --> HTTP
    GW --> Bridge
    GW --> CtrlUI

    GW --> PluginReg
    PluginReg --> TG
    PluginReg --> WA
    PluginReg --> DC
    PluginReg --> SL
    PluginReg --> SG
    PluginReg --> IM
    PluginReg --> MS

    TG --> PI
    WA --> PI
    DC --> PI
    SL --> PI
    SG --> PI
    IM --> PI
    MS --> PI

    PI --> PiCore
    PI --> Tools
    PI --> Skills
    PI --> SysPrompt
    PI --> SM

    SM --> SS
    SM --> MW

    GW --> Cron
    GW --> HB
    GW --> Hooks

    Tools --> Browser
    Tools --> Canvas
    Tools --> Nodes

    GW --> Config
    GW --> Logging
    GW --> Plugins
    PI --> Providers
```

### 1.2 架构图 (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLAWDBOT ARCHITECTURE                              │
│                        (TypeScript Source Analysis)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                    │
│  │ entry.ts    │ ──▶ │ cli/        │ ──▶ │ program.ts  │                    │
│  │ (入口点)    │     │ run-main.ts │     │ (Commander) │                    │
│  └─────────────┘     └─────────────┘     └──────┬──────┘                    │
│                                                  │                           │
│         ┌───────────────────────────────────────┘                           │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    GATEWAY SERVER (server.impl.ts)                   │    │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────────┐   │    │
│  │  │ WebSocket │  │   HTTP    │  │  Bridge   │  │  Control UI     │   │    │
│  │  │  Server   │  │  Server   │  │  Server   │  │  (Web 界面)     │   │    │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────────────────┘   │    │
│  │        │              │              │                               │    │
│  │  ┌─────┴──────────────┴──────────────┴──────────────────────────┐   │    │
│  │  │              Server Bridge (server-bridge.ts)                 │   │    │
│  │  │  - server-bridge-methods-chat.ts    (聊天方法)               │   │    │
│  │  │  - server-bridge-methods-config.ts  (配置方法)               │   │    │
│  │  │  - server-bridge-methods-sessions.ts (会话方法)              │   │    │
│  │  │  - server-bridge-methods-system.ts  (系统方法)               │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     │                                        │
│         ┌───────────────────────────┘                                       │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    CHANNEL PLUGINS (channels/plugins/)               │    │
│  │                                                                      │    │
│  │  ┌────────────────────────────────────────────────────────────────┐ │    │
│  │  │  index.ts - Plugin Registry & Resolution                       │ │    │
│  │  │  types.plugin.ts - ChannelPlugin<T> 接口定义                   │ │    │
│  │  │  types.core.ts - 核心类型 (ChannelCapabilities, ChannelMeta)   │ │    │
│  │  │  types.adapters.ts - 适配器类型                                │ │    │
│  │  └────────────────────────────────────────────────────────────────┘ │    │
│  │                                                                      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │    │
│  │  │telegram.ts│ │whatsapp.ts│ │discord.ts│ │ slack.ts │               │    │
│  │  │ (grammY) │ │ (Baileys)│ │(discord.js)│ │ (Bolt)  │               │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘               │    │
│  │                                                                      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                            │    │
│  │  │ signal.ts│ │imessage.ts│ │ msteams.ts│                            │    │
│  │  │(signal-cli)│ │ (imsg)  │ │(Bot FW)  │                            │    │
│  │  └──────────┘ └──────────┘ └──────────┘                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     │                                        │
│         ┌───────────────────────────┘                                       │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    AUTO-REPLY SYSTEM (auto-reply/)                   │    │
│  │                                                                      │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │ reply/get-reply.ts - getReplyFromConfig() 核心入口           │    │    │
│  │  │   ├── get-reply-directives.ts  (指令解析)                    │    │    │
│  │  │   ├── get-reply-inline-actions.ts (内联动作)                 │    │    │
│  │  │   ├── get-reply-run.ts (运行准备好的回复)                    │    │    │
│  │  │   ├── session.ts (Session 初始化)                            │    │    │
│  │  │   └── typing.ts (Typing 指示器)                              │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     │                                        │
│         ┌───────────────────────────┘                                       │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    AGENT RUNTIME (agents/)                           │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │ pi-embedded-runner/ - 核心 Agent 运行器                       │   │    │
│  │  │   ├── run.ts           (主运行逻辑)                           │   │    │
│  │  │   ├── run/attempt.ts   (单次尝试)                             │   │    │
│  │  │   ├── run/payloads.ts  (Payload 构建)                         │   │    │
│  │  │   ├── lanes.ts         (队列调度)                             │   │    │
│  │  │   ├── model.ts         (模型解析)                             │   │    │
│  │  │   ├── compact.ts       (Session 压缩)                         │   │    │
│  │  │   └── types.ts         (类型定义)                             │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │ system-prompt.ts - buildAgentSystemPrompt()                   │   │    │
│  │  │   构建完整的 System Prompt，包含:                             │   │    │
│  │  │   - 角色定义、工具说明、Skills、Memory Recall                │   │    │
│  │  │   - Workspace、Reply Tags、Messaging、Heartbeat              │   │    │
│  │  │   - Runtime 信息、Sandbox 信息                               │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │ tools/ - 工具实现                                             │   │    │
│  │  │   ├── browser-tool.ts     (浏览器控制)                        │   │    │
│  │  │   ├── canvas-tool.ts      (Canvas/A2UI)                       │   │    │
│  │  │   ├── nodes-tool.ts       (移动节点)                          │   │    │
│  │  │   ├── cron-tool.ts        (定时任务)                          │   │    │
│  │  │   ├── message-tool.ts     (消息发送)                          │   │    │
│  │  │   ├── gateway-tool.ts     (网关控制)                          │   │    │
│  │  │   ├── memory-tool.ts      (记忆搜索)                          │   │    │
│  │  │   ├── image-tool.ts       (图像分析)                          │   │    │
│  │  │   ├── session-status-tool.ts                                  │   │    │
│  │  │   ├── sessions-list-tool.ts                                   │   │    │
│  │  │   ├── sessions-send-tool.ts                                   │   │    │
│  │  │   ├── sessions-spawn-tool.ts                                  │   │    │
│  │  │   └── [channel]-actions.ts (渠道特定动作)                     │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    SUPPORTING SYSTEMS                                │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │    │
│  │  │ cron/        │  │ infra/       │  │ memory/                  │   │    │
│  │  │ service.ts   │  │ heartbeat-   │  │ manager.ts               │   │    │
│  │  │ (定时任务)   │  │ runner.ts    │  │ (语义搜索)               │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │    │
│  │  │ browser/     │  │ canvas-host/ │  │ plugins/                 │   │    │
│  │  │ (Playwright) │  │ (A2UI Host)  │  │ loader.ts                │   │    │
│  │  │              │  │              │  │ (插件加载)               │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 核心设计理念

1. **本地优先 (Local-first)**: Gateway 作为单一控制平面运行在本地设备
2. **多渠道统一**: 通过 `ChannelPlugin<T>` 泛型接口统一处理各种消息平台
3. **Agent 驱动**: 以 `@mariozechner/pi-coding-agent` 为核心的 AI Agent 交互模式
4. **可扩展性**: Skills、Plugins、Tools 提供灵活的扩展机制
5. **类型安全**: 全项目 TypeScript 严格模式，使用 Zod 进行运行时验证
6. **安全默认**: DM pairing 机制保护未经授权的访问

---

## 2. 模块结构

### 2.1 源码目录结构

```
src/
├── entry.ts                    # 程序入口点 (55 行)
├── index.ts                    # 模块导出和 CLI 初始化
├── runtime.ts                  # 运行时环境
├── globals.ts                  # 全局变量和标志
├── logging.ts                  # 日志系统入口
├── utils.ts                    # 通用工具函数
│
├── cli/                        # CLI 命令行界面 (82 个文件)
│   ├── program.ts              # Commander.js 程序定义
│   ├── run-main.ts             # 主运行入口
│   ├── deps.ts                 # 依赖注入 (createDefaultDeps)
│   ├── profile.ts              # CLI Profile 解析
│   ├── parse-duration.ts       # 时长解析
│   └── progress.ts             # 进度显示 (osc-progress + clack)
│
├── gateway/                    # 网关核心 (113 个文件)
│   ├── server.ts               # 导出入口
│   ├── server.impl.ts          # 主服务器实现
│   ├── server-bridge.ts        # Bridge 请求处理
│   ├── server-bridge-methods-*.ts  # 分类的 Bridge 方法
│   ├── server-chat.ts          # Chat 事件处理
│   ├── server-channels.ts      # Channel 管理
│   ├── server-http.ts          # HTTP 服务
│   ├── server-cron.ts          # Cron 集成
│   ├── server-startup.ts       # 启动逻辑
│   ├── config-reload.ts        # 配置热重载
│   ├── auth.ts                 # 认证授权
│   ├── hooks.ts                # Hooks 配置
│   ├── session-utils.ts        # Session 工具
│   └── protocol/               # 协议定义
│
├── agents/                     # Agent 系统 (246 个文件!)
│   ├── pi-embedded-runner.ts   # 导出入口
│   ├── pi-embedded-runner/     # 核心 Agent 运行器
│   │   ├── run.ts              # runEmbeddedPiAgent() 主函数
│   │   ├── run/attempt.ts      # 单次运行尝试
│   │   ├── run/payloads.ts     # Payload 构建
│   │   ├── lanes.ts            # 队列调度
│   │   ├── model.ts            # 模型解析
│   │   ├── compact.ts          # Session 压缩
│   │   ├── history.ts          # 历史管理
│   │   └── types.ts            # 类型定义
│   ├── system-prompt.ts        # System Prompt 构建
│   ├── skills.ts               # Skills 系统入口
│   ├── skills/                 # Skills 子模块
│   │   ├── workspace.ts        # Workspace Skills
│   │   ├── config.ts           # Skills 配置
│   │   └── types.ts            # 类型定义
│   ├── tools/                  # 工具实现 (40+ 文件)
│   ├── sandbox.ts              # 沙盒环境
│   ├── model-selection.ts      # 模型选择
│   ├── auth-profiles.ts        # 认证配置
│   ├── auth-profiles/          # 认证子模块
│   ├── workspace.ts            # 工作空间
│   ├── subagent-registry.ts    # 子 Agent 注册
│   ├── failover-error.ts       # 故障转移错误
│   ├── context-window-guard.ts # 上下文窗口守卫
│   └── defaults.ts             # 默认值
│
├── channels/                   # 渠道系统 (10 个文件)
│   ├── dock.ts                 # 渠道能力定义
│   ├── registry.ts             # 渠道 ID 注册
│   ├── location.ts             # 位置服务
│   ├── plugins/                # 渠道插件 (35+ 文件)
│   │   ├── index.ts            # 插件注册表
│   │   ├── types.plugin.ts     # ChannelPlugin<T> 接口
│   │   ├── types.core.ts       # 核心类型
│   │   ├── types.adapters.ts   # 适配器类型
│   │   ├── telegram.ts         # Telegram 实现
│   │   ├── whatsapp.ts         # WhatsApp 实现
│   │   ├── discord.ts          # Discord 实现
│   │   ├── slack.ts            # Slack 实现
│   │   ├── signal.ts           # Signal 实现
│   │   ├── imessage.ts         # iMessage 实现
│   │   ├── msteams.ts          # MS Teams 实现
│   │   ├── onboarding/         # 引导流程
│   │   ├── outbound/           # 出站处理
│   │   ├── actions/            # 消息动作
│   │   └── status-issues/      # 状态问题检测
│   └── web/                    # Web 渠道
│
├── auto-reply/                 # 自动回复系统 (70 个文件)
│   ├── reply.ts                # 导出入口
│   ├── reply/                  # 回复子模块
│   │   ├── get-reply.ts        # getReplyFromConfig() 核心
│   │   ├── get-reply-directives.ts    # 指令解析
│   │   ├── get-reply-inline-actions.ts # 内联动作
│   │   ├── get-reply-run.ts    # 运行回复
│   │   ├── session.ts          # Session 初始化
│   │   ├── typing.ts           # Typing 指示器
│   │   ├── reply-tags.ts       # Reply Tags
│   │   └── directives.ts       # 指令提取
│   ├── chunk.ts                # 消息分块
│   ├── heartbeat.ts            # Heartbeat 处理
│   ├── templating.ts           # 模板系统
│   ├── thinking.ts             # Thinking 级别
│   ├── tokens.ts               # Token 常量
│   ├── command-auth.ts         # 命令授权
│   └── transcription.ts        # 音频转录
│
├── config/                     # 配置系统 (94 个文件)
│   ├── config.ts               # 配置加载
│   ├── io.ts                   # 配置 I/O
│   ├── schema.ts               # 配置 Schema
│   ├── zod-schema.ts           # Zod 主 Schema
│   ├── zod-schema.*.ts         # 分模块 Schema
│   ├── sessions.ts             # Session 配置
│   ├── paths.ts                # 路径解析
│   ├── defaults.ts             # 默认值
│   └── validation.ts           # 验证
│
├── cron/                       # 定时任务 (23 个文件)
│   ├── service.ts              # CronService 类
│   ├── service/                # 服务子模块
│   │   ├── ops.ts              # 操作实现
│   │   └── state.ts            # 状态管理
│   ├── types.ts                # 类型定义
│   ├── store.ts                # 任务存储
│   ├── schedule.ts             # 调度计算
│   ├── normalize.ts            # 规范化
│   └── isolated-agent.ts       # 隔离 Agent 执行
│
├── plugins/                    # 插件系统 (16 个文件)
│   ├── loader.ts               # 插件加载器
│   ├── discovery.ts            # 插件发现
│   ├── registry.ts             # 插件注册表
│   ├── runtime.ts              # 运行时状态
│   ├── services.ts             # 插件服务
│   └── types.ts                # 类型定义
│
├── browser/                    # 浏览器控制 (63 个文件)
│   ├── client.ts               # 浏览器客户端
│   ├── client-actions.ts       # 浏览器动作
│   ├── chrome.ts               # Chrome 控制
│   ├── cdp.ts                  # CDP 协议
│   ├── config.ts               # 配置
│   ├── pw-tools-core.ts        # Playwright 核心
│   ├── pw-session.ts           # Playwright Session
│   ├── profiles.ts             # 浏览器配置文件
│   └── server.ts               # 浏览器服务器
│
├── memory/                     # 记忆系统 (10 个文件)
│   ├── index.ts                # 导出入口
│   ├── manager.ts              # MemoryIndexManager
│   ├── search-manager.ts       # 搜索管理器
│   ├── embeddings.ts           # 嵌入向量
│   └── chunking.ts             # 文本分块
│
├── infra/                      # 基础设施 (101 个文件)
│   ├── heartbeat-runner.ts     # Heartbeat 执行
│   ├── heartbeat-events.ts     # Heartbeat 事件
│   ├── heartbeat-wake.ts       # Heartbeat 唤醒
│   ├── system-presence.ts      # 系统状态
│   ├── agent-events.ts         # Agent 事件
│   ├── bonjour.ts              # mDNS 发现
│   ├── bonjour-discovery.ts    # Bonjour 发现
│   ├── tailscale.ts            # Tailscale 集成
│   ├── state-migrations.ts     # 状态迁移
│   ├── restart.ts              # 重启逻辑
│   ├── update-runner.ts        # 更新运行器
│   └── outbound/               # 出站消息
│
├── commands/                   # CLI 命令实现 (159 个文件)
│   ├── agent.ts                # agent 命令
│   ├── status.ts               # status 命令
│   ├── configure.ts            # configure 命令
│   ├── doctor.ts               # doctor 命令
│   ├── health.ts               # health 命令
│   ├── sessions.ts             # sessions 命令
│   ├── message.ts              # message 命令
│   ├── onboard.ts              # onboard 命令
│   └── ...
│
├── [渠道独立目录]/              # 渠道实现细节
│   ├── telegram/               # (58 个文件)
│   ├── discord/                # (34 个文件)
│   ├── slack/                  # (22 个文件)
│   ├── signal/                 # (20 个文件)
│   ├── imessage/               # (15 个文件)
│   ├── msteams/                # (37 个文件)
│   ├── whatsapp/               # (4 个文件)
│   └── web/                    # (47 个文件)
│
└── [其他模块]/
    ├── canvas-host/            # Canvas Host
    ├── wizard/                 # 引导向导
    ├── terminal/               # 终端 UI
    ├── tui/                    # TUI 组件
    ├── security/               # 安全模块
    ├── media/                  # 媒体处理
    ├── hooks/                  # Hooks 系统
    ├── pairing/                # 配对系统
    ├── logging/                # 日志子模块
    ├── daemon/                 # 守护进程
    └── types/                  # 全局类型
```

### 2.2 模块职责表

| 模块 | 文件数 | 职责 | 关键文件 |
|------|--------|------|----------|
| **agents** | 246 | Agent 运行时，工具执行，系统提示构建 | `pi-embedded-runner/run.ts` |
| **commands** | 159 | CLI 命令实现 | `agent.ts`, `status.ts` |
| **gateway** | 113 | 网关服务核心，WebSocket/HTTP，消息路由 | `server.impl.ts` |
| **infra** | 101 | 基础设施服务 | `heartbeat-runner.ts` |
| **config** | 94 | 配置加载/验证/持久化 | `zod-schema.ts` |
| **cli** | 82 | CLI 界面和交互 | `program.ts` |
| **auto-reply** | 70 | 消息处理流程，命令解析 | `reply/get-reply.ts` |
| **browser** | 63 | Playwright 浏览器自动化 | `pw-tools-core.ts` |
| **telegram** | 58 | Telegram 渠道实现 | `monitor.ts`, `send.ts` |
| **web** | 47 | Web/WebChat 渠道 | `session.ts` |
| **msteams** | 37 | MS Teams 渠道 | `adapter.ts` |
| **channels/plugins** | 35 | 渠道插件系统 | `types.plugin.ts` |
| **discord** | 34 | Discord 渠道 | `monitor.ts` |
| **cron** | 23 | 定时任务调度 | `service.ts` |
| **slack** | 22 | Slack 渠道 | `monitor.ts` |
| **signal** | 20 | Signal 渠道 | `monitor.ts` |
| **plugins** | 16 | 第三方插件加载 | `loader.ts` |
| **imessage** | 15 | iMessage 渠道 | `monitor.ts` |
| **memory** | 10 | 语义搜索和记忆 | `manager.ts` |

### 2.3 依赖关系图

```
┌──────────────────────────────────────────────────────────────────┐
│                        外部依赖                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  AI 引擎:                                                         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ @mariozechner/pi-coding-agent  (Agent 核心)              │    │
│  │ @mariozechner/pi-agent-core    (Agent 接口)              │    │
│  │ @mariozechner/pi-ai            (AI 流处理)               │    │
│  │ ai                             (Vercel AI SDK)           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  消息平台 SDK:                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ grammy           (Telegram Bot API)                       │    │
│  │ @whiskeysockets/baileys (WhatsApp Web)                    │    │
│  │ discord.js       (Discord API)                            │    │
│  │ @slack/bolt      (Slack Bolt)                             │    │
│  │ botbuilder       (MS Teams Bot Framework)                 │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  浏览器自动化:                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ playwright        (跨浏览器自动化)                        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  CLI/TUI:                                                         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ commander         (CLI 框架)                              │    │
│  │ @clack/prompts    (交互式提示)                            │    │
│  │ chalk             (终端颜色)                              │    │
│  │ ora / osc-progress (进度显示)                             │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  验证/序列化:                                                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ zod               (Schema 验证)                           │    │
│  │ @sinclair/typebox (JSON Schema)                           │    │
│  │ json5             (JSON5 解析)                            │    │
│  │ ajv               (JSON Schema 验证)                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  网络/WebSocket:                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ ws                (WebSocket)                             │    │
│  │ fetch (built-in)  (HTTP 客户端)                           │    │
│  │ ciao              (mDNS/Bonjour)                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 消息处理流程

### 3.1 消息流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE PROCESSING FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐                                                        │
│  │ 外部消息到达      │  (Telegram Bot / WhatsApp Web / Discord Bot / ...)    │
│  └────────┬─────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    CHANNEL PLUGIN                                       │ │
│  │  src/channels/plugins/<channel>.ts                                      │ │
│  │                                                                         │ │
│  │  1. 接收消息 (Bot API / WebSocket / Webhook)                            │ │
│  │  2. 解析消息内容 (文本/媒体/附件/回复)                                  │ │
│  │  3. 提取发送者信息 (From, SenderName, SenderE164, ...)                 │ │
│  │  4. 判断消息类型 (direct/group/channel/thread)                         │ │
│  │  5. 构建 MsgContext 对象                                                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│           │                                                                  │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    SECURITY CHECK                                       │ │
│  │  src/channels/plugins/types.adapters.ts - ChannelSecurityAdapter        │ │
│  │                                                                         │ │
│  │  resolveDmPolicy():                                                     │ │
│  │    ├── policy: "pairing" | "open"                                       │ │
│  │    ├── allowFrom: string[]                                              │ │
│  │    └── normalizeEntry: (raw) => normalized                              │ │
│  │                                                                         │ │
│  │  如果是 pairing 模式:                                                   │ │
│  │    - 检查发送者是否在 allowFrom 列表                                    │ │
│  │    - 如果不在，检查是否发送了 pairing code                              │ │
│  │    - 如果是有效的 pairing code，添加到 allowFrom                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│           │                                                                  │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    AUTO-REPLY ENTRY                                     │ │
│  │  src/auto-reply/reply/get-reply.ts                                      │ │
│  │                                                                         │ │
│  │  getReplyFromConfig(ctx: MsgContext, opts?: GetReplyOptions):           │ │
│  │                                                                         │ │
│  │  ┌────────────────────────────────────────────────────────────────┐    │ │
│  │  │ 1. initSessionState()                                           │    │ │
│  │  │    - 解析 agentId, sessionKey, workspaceDir                     │    │ │
│  │  │    - 加载 sessionStore, sessionEntry                            │    │ │
│  │  │    - 确保 workspace 存在                                        │    │ │
│  │  └────────────────────────────────────────────────────────────────┘    │ │
│  │                              │                                          │ │
│  │                              ▼                                          │ │
│  │  ┌────────────────────────────────────────────────────────────────┐    │ │
│  │  │ 2. resolveReplyDirectives()                                     │    │ │
│  │  │    - 解析内联指令 (/reasoning, /think, /verbose, /elevated)     │    │ │
│  │  │    - 解析 reply tags ([[reply_to_current]])                     │    │ │
│  │  │    - 解析队列指令 ([[queue:wait]])                              │    │ │
│  │  │    - 检测命令 (/help, /status, /reset, /compact, ...)          │    │ │
│  │  └────────────────────────────────────────────────────────────────┘    │ │
│  │                              │                                          │ │
│  │                              ▼                                          │ │
│  │  ┌────────────────────────────────────────────────────────────────┐    │ │
│  │  │ 3. handleInlineActions()                                        │    │ │
│  │  │    - 处理 /help, /status, /reset, /compact                      │    │ │
│  │  │    - 检查命令授权 (resolveCommandAuthorization)                 │    │ │
│  │  │    - 如果是纯命令，直接返回响应                                 │    │ │
│  │  └────────────────────────────────────────────────────────────────┘    │ │
│  │                              │                                          │ │
│  │              ┌───────────────┼───────────────┐                          │ │
│  │              │               │               │                          │ │
│  │              ▼               ▼               ▼                          │ │
│  │      ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │ │
│  │      │ 命令响应    │ │ 指令确认    │ │ Agent 处理  │                    │ │
│  │      │ (如 /help)  │ │ (如 ack)    │ │ (正常对话)  │                    │ │
│  │      └─────────────┘ └─────────────┘ └──────┬──────┘                    │ │
│  │                                             │                           │ │
│  └─────────────────────────────────────────────┼───────────────────────────┘ │
│                                                │                             │
│           ┌────────────────────────────────────┘                             │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    RUN PREPARED REPLY                                   │ │
│  │  src/auto-reply/reply/get-reply-run.ts                                  │ │
│  │                                                                         │ │
│  │  runPreparedReply():                                                    │ │
│  │    1. 准备 Agent 参数                                                   │ │
│  │    2. 构建 Skills Snapshot                                              │ │
│  │    3. 调用 runEmbeddedPiAgent()                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│           │                                                                  │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    PI EMBEDDED RUNNER                                   │ │
│  │  src/agents/pi-embedded-runner/run.ts                                   │ │
│  │                                                                         │ │
│  │  runEmbeddedPiAgent(params: RunEmbeddedPiAgentParams):                  │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │ Lane Scheduling (队列调度)                                       │   │ │
│  │  │   - sessionLane: 每个 session 独立队列                           │   │ │
│  │  │   - globalLane: 全局速率限制                                     │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                              │                                          │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │ Auth Profile Resolution (认证解析)                               │   │ │
│  │  │   - resolveAuthProfileOrder() 获取认证顺序                       │   │ │
│  │  │   - getApiKeyForModel() 获取 API Key                            │   │ │
│  │  │   - 支持 failover 到备用 profile                                 │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                              │                                          │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │ Run Attempt Loop (运行尝试循环)                                  │   │ │
│  │  │   while (true):                                                  │   │ │
│  │  │     attempt = runEmbeddedAttempt(...)                            │   │ │
│  │  │     if (success) break                                           │   │ │
│  │  │     if (failover possible):                                      │   │ │
│  │  │       - 尝试降级 thinking level                                  │   │ │
│  │  │       - 尝试切换 auth profile                                    │   │ │
│  │  │     else: throw                                                  │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│           │                                                                  │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    RESPONSE DELIVERY                                    │ │
│  │                                                                         │ │
│  │  1. 文本分块 (chunkMarkdownText)                                        │ │
│  │     - Telegram: 4000 字符                                               │ │
│  │     - Discord: 2000 字符                                                │ │
│  │     - WhatsApp: 4096 字符                                               │ │
│  │                                                                         │ │
│  │  2. 媒体处理                                                            │ │
│  │     - 图片/视频/文件发送                                                │ │
│  │                                                                         │ │
│  │  3. Reply Tags 处理                                                     │ │
│  │     - [[reply_to_current]] -> 回复原消息                               │ │
│  │     - [[reply_to:<id>]] -> 回复指定消息                                │ │
│  │                                                                         │ │
│  │  4. Typing Indicator                                                    │ │
│  │     - 发送前显示 "正在输入..."                                          │ │
│  │                                                                         │ │
│  │  5. 发送回复                                                            │ │
│  │     - Channel Plugin 的 outbound.send()                                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 MsgContext 类型定义

```typescript
// src/auto-reply/templating.ts

export interface MsgContext {
  // 发送者信息
  From: string;                    // 发送者唯一标识
  SenderName: string;              // 发送者显示名称
  SenderUsername?: string;         // 用户名 (@username)
  SenderE164?: string;             // E.164 格式电话号码 (WhatsApp/Signal)
  SenderTag?: string;              // Discord 用户 Tag
  AccountId?: string;              // 多账号场景下的账号 ID
  
  // 消息信息
  Body: string;                    // 消息正文
  MediaUrl?: string;               // 单个媒体 URL
  MediaUrls?: string[];            // 多个媒体 URL
  AudioUrl?: string;               // 音频 URL (语音消息)
  MessageId?: string;              // 消息唯一 ID
  ReplyToId?: string;              // 回复的消息 ID
  
  // 渠道信息
  Provider?: string;               // 渠道类型 (telegram/whatsapp/discord/...)
  ChatType?: "direct" | "group" | "channel" | "thread";
  GroupId?: string;                // 群组 ID
  GroupName?: string;              // 群组名称
  ThreadId?: string;               // 线程 ID
  ChannelId?: string;              // Discord/Slack 频道 ID
  
  // 元数据
  Timestamp?: number;              // 消息时间戳
  IsBot?: boolean;                 // 是否来自机器人
  Mentioned?: boolean;             // 是否被 @ 提及
  
  // 扩展字段 (渠道特定)
  [key: string]: unknown;
}
```

### 3.3 关键代码路径

```typescript
// 1. Channel Plugin 接收消息 (以 Telegram 为例)
// src/telegram/monitor.ts
bot.on("message", async (ctx) => {
  const msgContext = buildMsgContext(ctx);
  const reply = await getReplyFromConfig(msgContext);
  if (reply) await sendReply(ctx, reply);
});

// 2. 核心回复入口
// src/auto-reply/reply/get-reply.ts
export async function getReplyFromConfig(
  ctx: MsgContext,
  opts?: GetReplyOptions,
  configOverride?: ClawdbotConfig,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  
  // 2.1 初始化 Session 状态
  const sessionCtx = await initSessionState({ ctx, cfg, opts });
  
  // 2.2 解析指令和命令
  const directiveResult = await resolveReplyDirectives({...});
  
  // 2.3 处理内联动作 (命令)
  const inlineResult = await handleInlineActions({...});
  if (inlineResult.kind === "reply") return inlineResult.reply;
  
  // 2.4 运行 Agent
  return runPreparedReply({...});
}

// 3. Agent 运行
// src/agents/pi-embedded-runner/run.ts
export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  
  // 3.1 队列调度
  const sessionLane = resolveSessionLane(params.sessionKey);
  const globalLane = resolveGlobalLane(params.lane);
  
  return enqueueCommandInLane(sessionLane, () =>
    enqueueCommandInLane(globalLane, async () => {
      
      // 3.2 解析模型
      const { model, authStorage } = resolveModel(provider, modelId, agentDir);
      
      // 3.3 认证配置
      const profileOrder = resolveAuthProfileOrder({...});
      await applyApiKeyInfo(profileCandidates[profileIndex]);
      
      // 3.4 运行尝试循环 (支持 failover)
      while (true) {
        const attempt = await runEmbeddedAttempt({...});
        if (attempt.ok) return attempt.result;
        
        // 尝试 failover
        const canFailover = await advanceAuthProfile();
        if (!canFailover) throw attempt.error;
      }
    }),
  );
}
```

---

## 4. Agent 系统

### 4.1 Agent 运行时架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT RUNTIME                                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Pi Embedded Runner                                    ││
│  │                    src/agents/pi-embedded-runner/                        ││
│  │                                                                          ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │ run.ts - runEmbeddedPiAgent()                                        │││
│  │  │                                                                       │││
│  │  │  主入口函数，负责:                                                    │││
│  │  │  - 队列调度 (sessionLane + globalLane)                               │││
│  │  │  - 模型解析和认证                                                     │││
│  │  │  - 运行尝试循环 (支持 failover)                                      │││
│  │  │  - 错误处理和恢复                                                     │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  │                                                                          ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │ run/attempt.ts - runEmbeddedAttempt()                                │││
│  │  │                                                                       │││
│  │  │  单次运行尝试，负责:                                                  │││
│  │  │  - 创建 SessionManager                                               │││
│  │  │  - 构建 System Prompt                                                │││
│  │  │  - 准备 Tools                                                        │││
│  │  │  - 调用 @mariozechner/pi-coding-agent                                │││
│  │  │  - 流式输出处理                                                       │││
│  │  │  - 保存 Session                                                       │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  │                                                                          ││
│  │  ┌──────────────────────┐  ┌──────────────────────┐                     ││
│  │  │ lanes.ts             │  │ model.ts             │                     ││
│  │  │ 队列调度             │  │ 模型解析             │                     ││
│  │  │ - sessionLane        │  │ - provider 解析      │                     ││
│  │  │ - globalLane         │  │ - model 加载         │                     ││
│  │  └──────────────────────┘  └──────────────────────┘                     ││
│  │                                                                          ││
│  │  ┌──────────────────────┐  ┌──────────────────────┐                     ││
│  │  │ compact.ts           │  │ history.ts           │                     ││
│  │  │ Session 压缩         │  │ 历史管理             │                     ││
│  │  │ - 自动压缩           │  │ - 限制历史轮数       │                     ││
│  │  │ - 手动 /compact      │  │ - DM 历史限制        │                     ││
│  │  └──────────────────────┘  └──────────────────────┘                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    External Dependency                                   ││
│  │                    @mariozechner/pi-coding-agent                         ││
│  │                                                                          ││
│  │  提供核心功能:                                                           ││
│  │  - createAgentSession()  创建 Agent 会话                                ││
│  │  - SessionManager        会话管理器                                      ││
│  │  - SettingsManager       设置管理器                                      ││
│  │  - discoverModels()      模型发现                                        ││
│  │  - loadSkillsFromDir()   Skills 加载                                    ││
│  │  - formatSkillsForPrompt() Skills 格式化                                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    System Prompt Builder                                 ││
│  │                    src/agents/system-prompt.ts                           ││
│  │                                                                          ││
│  │  buildAgentSystemPrompt(params):                                         ││
│  │                                                                          ││
│  │  生成的 System Prompt 包含:                                              ││
│  │  ┌─────────────────────────────────────────────────────────────────┐    ││
│  │  │ 1. 角色定义                                                      │    ││
│  │  │    "You are a personal assistant running inside Clawdbot."      │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 2. 工具说明 (## Tooling)                                         │    ││
│  │  │    - Tool names are case-sensitive                              │    ││
│  │  │    - 每个工具的简短描述                                          │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 3. Skills 说明 (## Skills)                                       │    ││
│  │  │    - <available_skills> XML 列表                                │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 4. Memory Recall 说明 (## Memory Recall)                         │    ││
│  │  │    - memory_search + memory_get 使用指南                        │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 5. Self-Update 说明 (## Clawdbot Self-Update)                    │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 6. Model Aliases (## Model Aliases)                              │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 7. Workspace 信息 (## Workspace)                                 │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 8. Reply Tags (## Reply Tags)                                    │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 9. Messaging 说明 (## Messaging)                                 │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 10. Group Chat Context (条件性)                                  │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 11. Silent Replies (## Silent Replies)                           │    ││
│  │  │     - NO_REPLY 机制                                             │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 12. Heartbeats (## Heartbeats)                                   │    ││
│  │  │     - HEARTBEAT_OK 机制                                         │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 13. Runtime 信息 (## Runtime)                                    │    ││
│  │  │     host | os | node | model | thinking                         │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 14. Sandbox 信息 (条件性)                                        │    ││
│  │  ├─────────────────────────────────────────────────────────────────┤    ││
│  │  │ 15. 用户自定义 extraSystemPrompt                                 │    ││
│  │  └─────────────────────────────────────────────────────────────────┘    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    TOOLS (src/agents/tools/)                             ││
│  │                                                                          ││
│  │  Core Tools:                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────┐    ││
│  │  │ 文件操作:                                                        │    ││
│  │  │   read, write, edit (来自 pi-coding-agent)                      │    ││
│  │  │                                                                  │    ││
│  │  │ 命令执行:                                                        │    ││
│  │  │   exec, bash, process (src/agents/bash-tools.ts)                │    ││
│  │  └─────────────────────────────────────────────────────────────────┘    ││
│  │                                                                          ││
│  │  Clawdbot Tools:                                                         ││
│  │  ┌─────────────────────────────────────────────────────────────────┐    ││
│  │  │ browser-tool.ts     浏览器控制 (Playwright)                      │    ││
│  │  │   - status/start/stop/tabs/open/snapshot/screenshot/act         │    ││
│  │  │                                                                  │    ││
│  │  │ canvas-tool.ts      Canvas/A2UI                                  │    ││
│  │  │   - present/hide/navigate/eval/snapshot/a2ui_push               │    ││
│  │  │                                                                  │    ││
│  │  │ nodes-tool.ts       移动节点控制                                 │    ││
│  │  │   - status/describe/notify/camera_snap/screen_record/location   │    ││
│  │  │                                                                  │    ││
│  │  │ cron-tool.ts        定时任务                                     │    ││
│  │  │   - status/list/add/update/remove/run/runs/wake                 │    ││
│  │  │                                                                  │    ││
│  │  │ message-tool.ts     消息发送                                     │    ││
│  │  │   - send/react/poll/reactions/read/edit/delete/pin/...          │    ││
│  │  │                                                                  │    ││
│  │  │ gateway-tool.ts     网关控制                                     │    ││
│  │  │   - restart/config.get/config.apply/update.run                  │    ││
│  │  │                                                                  │    ││
│  │  │ memory-tool.ts      记忆搜索                                     │    ││
│  │  │   - memory_search/memory_get                                    │    ││
│  │  │                                                                  │    ││
│  │  │ image-tool.ts       图像分析                                     │    ││
│  │  │   - 使用配置的 imageModel 分析图像                              │    ││
│  │  └─────────────────────────────────────────────────────────────────┘    ││
│  │                                                                          ││
│  │  Session Tools:                                                          ││
│  │  ┌─────────────────────────────────────────────────────────────────┐    ││
│  │  │ session-status-tool.ts   显示 session 状态                       │    ││
│  │  │ sessions-list-tool.ts    列出 sessions                           │    ││
│  │  │ sessions-send-tool.ts    跨 session 发消息                       │    ││
│  │  │ sessions-spawn-tool.ts   创建子 agent                            │    ││
│  │  │ sessions-history-tool.ts 获取 session 历史                       │    ││
│  │  │ agents-list-tool.ts      列出可用 agents                         │    ││
│  │  └─────────────────────────────────────────────────────────────────┘    ││
│  │                                                                          ││
│  │  Channel Tools:                                                          ││
│  │  ┌─────────────────────────────────────────────────────────────────┐    ││
│  │  │ telegram-actions.ts  Telegram 特定操作                           │    ││
│  │  │ discord-actions.ts   Discord 特定操作 (guild/messaging/mod)      │    ││
│  │  │ slack-actions.ts     Slack 特定操作                              │    ││
│  │  │ whatsapp-actions.ts  WhatsApp 特定操作                           │    ││
│  │  └─────────────────────────────────────────────────────────────────┘    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Subagent 系统

```typescript
// src/agents/subagent-registry.ts

// 子 Agent 用于处理长时间运行或复杂任务
// 由主 Agent 通过 sessions_spawn 工具创建

export interface SubagentEntry {
  sessionKey: string;           // 子 agent 的 session key
  parentSessionKey: string;     // 父 agent 的 session key
  task: string;                 // 分配的任务描述
  createdAt: number;            // 创建时间
  status: "running" | "completed" | "error";
  lastActivityAt: number;       // 最后活动时间
}

// 子 Agent 的 System Prompt 会注入特殊上下文
const subagentContextSection = `
# Subagent Context

You are a **subagent** spawned by the main agent for a specific task.

## Your Role
- You were created to handle: ${task}
- Complete this task and report back.

## Rules
1. Stay focused - Do your assigned task, nothing else
2. Report completion - When done, summarize results
3. Don't initiate - No heartbeats, no proactive actions
4. Notify parent - Use sessions_send to report to parent agent
`;
```

---

## 5. Channel/Plugin 机制

### 5.1 ChannelPlugin 接口

```typescript
// src/channels/plugins/types.plugin.ts

export type ChannelPlugin<ResolvedAccount = any> = {
  // 标识
  id: ChannelId;                              // "telegram" | "whatsapp" | ...
  meta: ChannelMeta;                          // 元数据 (label, docs, blurb)
  capabilities: ChannelCapabilities;           // 能力声明
  
  // 配置热重载
  reload?: { 
    configPrefixes: string[];                 // 触发重载的配置前缀
    noopPrefixes?: string[];                  // 忽略的配置前缀
  };
  
  // CLI 引导
  onboarding?: ChannelOnboardingAdapter;      // 引导向导钩子
  
  // 配置适配器
  config: ChannelConfigAdapter<ResolvedAccount>;
  
  // 设置适配器
  setup?: ChannelSetupAdapter;
  
  // 配对适配器
  pairing?: ChannelPairingAdapter;
  
  // 安全适配器
  security?: ChannelSecurityAdapter<ResolvedAccount>;
  
  // 群组适配器
  groups?: ChannelGroupAdapter;
  
  // 提及适配器
  mentions?: ChannelMentionAdapter;
  
  // 出站适配器
  outbound?: ChannelOutboundAdapter;
  
  // 状态适配器
  status?: ChannelStatusAdapter<ResolvedAccount>;
  
  // Gateway 方法
  gatewayMethods?: string[];
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  
  // 认证适配器
  auth?: ChannelAuthAdapter;
  
  // Elevated 权限适配器
  elevated?: ChannelElevatedAdapter;
  
  // 命令适配器
  commands?: ChannelCommandAdapter;
  
  // 流式适配器
  streaming?: ChannelStreamingAdapter;
  
  // 线程适配器
  threading?: ChannelThreadingAdapter;
  
  // 消息适配器
  messaging?: ChannelMessagingAdapter;
  
  // 消息动作适配器
  actions?: ChannelMessageActionAdapter;
  
  // Heartbeat 适配器
  heartbeat?: ChannelHeartbeatAdapter;
  
  // 渠道特有的 Agent 工具
  agentTools?: ChannelAgentToolFactory | ChannelAgentTool[];
};
```

### 5.2 ChannelCapabilities 类型

```typescript
// src/channels/plugins/types.core.ts

export type ChannelCapabilities = {
  chatTypes: Array<"direct" | "group" | "channel" | "thread">;
  polls?: boolean;           // 支持投票
  reactions?: boolean;       // 支持表情反应
  threads?: boolean;         // 支持消息线程
  media?: boolean;           // 支持媒体发送
  nativeCommands?: boolean;  // 支持原生命令 (/ 菜单)
  blockStreaming?: boolean;  // 支持流式分块输出
};
```

### 5.3 内置 Channel Plugins

```typescript
// src/channels/plugins/index.ts

function resolveCoreChannels(): ChannelPlugin[] {
  return [
    telegramPlugin,      // Telegram (grammY)
    whatsappPlugin,      // WhatsApp (Baileys)
    discordPlugin,       // Discord (discord.js)
    slackPlugin,         // Slack (Bolt)
    signalPlugin,        // Signal (signal-cli)
    imessagePlugin,      // iMessage (imsg CLI)
    msteamsPlugin,       // MS Teams (Bot Framework)
  ];
}

// 插件注册和排序
export function listChannelPlugins(): ChannelPlugin[] {
  const combined = dedupeChannels([...resolveCoreChannels(), ...listPluginChannels()]);
  return combined.sort((a, b) => {
    const orderA = a.meta.order ?? CHAT_CHANNEL_ORDER.indexOf(a.id);
    const orderB = b.meta.order ?? CHAT_CHANNEL_ORDER.indexOf(b.id);
    return orderA - orderB;
  });
}
```

### 5.4 Telegram Plugin 示例

```typescript
// src/channels/plugins/telegram.ts

export const telegramPlugin: ChannelPlugin<ResolvedTelegramAccount> = {
  id: "telegram",
  
  meta: {
    ...getChatChannelMeta("telegram"),
    quickstartAllowFrom: true,
  },
  
  capabilities: {
    chatTypes: ["direct", "group", "channel", "thread"],
    reactions: true,
    threads: true,
    media: true,
    nativeCommands: true,
    blockStreaming: true,
  },
  
  reload: { configPrefixes: ["channels.telegram"] },
  
  onboarding: telegramOnboardingAdapter,
  
  pairing: {
    idLabel: "telegramUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(telegram|tg):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const { token } = resolveTelegramToken(cfg);
      await sendMessageTelegram(id, PAIRING_APPROVED_MESSAGE, { token });
    },
  },
  
  config: {
    listAccountIds: (cfg) => listTelegramAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveTelegramAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultTelegramAccountId(cfg),
    isConfigured: (account) => Boolean(account.token?.trim()),
    // ...
  },
  
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      // ...
    }),
  },
  
  groups: {
    resolveRequireMention: resolveTelegramGroupRequireMention,
  },
  
  threading: {
    resolveReplyToMode: ({ cfg }) => cfg.channels?.telegram?.replyToMode ?? "first",
  },
  
  messaging: {
    normalizeTarget: normalizeTelegramMessagingTarget,
  },
  
  actions: telegramMessageActions,
  
  outbound: {
    deliveryMode: "direct",
    chunker: chunkMarkdownText,
    textChunkLimit: 4000,
    // ...
  },
};
```

---

## 6. Heartbeat 和 Cron 机制

### 6.1 Heartbeat 机制

```typescript
// src/infra/heartbeat-runner.ts

// Heartbeat 定期唤醒 Agent 检查待办事项

export async function runHeartbeatOnce(opts: HeartbeatRunOptions): Promise<HeartbeatRunResult> {
  const cfg = opts.cfg ?? loadConfig();
  
  // 1. 检查是否启用
  if (!heartbeatsEnabled) {
    return { status: "skipped", reason: "disabled" };
  }
  
  const intervalMs = resolveHeartbeatIntervalMs(cfg);
  if (!intervalMs) {
    return { status: "skipped", reason: "disabled" };
  }
  
  // 2. 获取 Heartbeat Prompt
  const heartbeatPrompt = resolveHeartbeatPrompt(cfg);
  // 默认: "Consider outstanding tasks and HEARTBEAT.md guidance..."
  
  // 3. 获取 Session
  const { sessionKey, storePath, store, entry } = resolveHeartbeatSession(cfg);
  
  // 4. 构建上下文并调用 Agent
  const ctx: MsgContext = {
    From: resolveHeartbeatSender({ allowFrom, lastTo }),
    Body: heartbeatPrompt,
    Provider: INTERNAL_MESSAGE_CHANNEL,
    // ...
  };
  
  const replyResult = await getReplyFromConfig(ctx, {
    messageKind: "heartbeat",
    skipTyping: true,
    // ...
  });
  
  // 5. 处理响应
  const payload = resolveHeartbeatReplyPayload(replyResult);
  const normalized = normalizeHeartbeatReply(payload, responsePrefix, ackMaxChars);
  
  if (normalized.shouldSkip) {
    // HEARTBEAT_OK - 无事发生
    return { status: "ack" };
  }
  
  // 6. 发送 Heartbeat 回复
  await deliverOutboundPayloads({
    cfg,
    payloads: [payload],
    target: deliveryTarget,
  });
  
  return { status: "delivered" };
}

// Heartbeat 间隔解析
export function resolveHeartbeatIntervalMs(cfg: ClawdbotConfig, overrideEvery?: string) {
  const raw = overrideEvery ?? cfg.agents?.defaults?.heartbeat?.every ?? DEFAULT_HEARTBEAT_EVERY;
  // DEFAULT_HEARTBEAT_EVERY = "15m"
  return parseDurationMs(raw, { defaultUnit: "m" });
}
```

### 6.2 Cron 服务

```typescript
// src/cron/service.ts

export class CronService {
  private readonly state;
  
  constructor(deps: CronServiceDeps) {
    this.state = createCronServiceState(deps);
  }

  async start() {
    await ops.start(this.state);
  }

  stop() {
    ops.stop(this.state);
  }

  async list(opts?: { includeDisabled?: boolean }) {
    return await ops.list(this.state, opts);
  }

  async add(input: CronJobCreate) {
    return await ops.add(this.state, input);
  }

  async update(id: string, patch: CronJobPatch) {
    return await ops.update(this.state, id, patch);
  }

  async remove(id: string) {
    return await ops.remove(this.state, id);
  }

  async run(id: string, mode?: "due" | "force") {
    return await ops.run(this.state, id, mode);
  }

  wake(opts: { mode: "now" | "next-heartbeat"; text: string }) {
    return ops.wakeNow(this.state, opts);
  }
}
```

### 6.3 Cron Job 类型

```typescript
// src/cron/types.ts

// 调度类型
export type CronSchedule =
  | { kind: "at"; atMs: number }                           // 一次性，指定时间
  | { kind: "every"; everyMs: number; anchorMs?: number }  // 周期性
  | { kind: "cron"; expr: string; tz?: string };           // Cron 表达式

// 执行目标
export type CronSessionTarget = "main" | "isolated";

// 唤醒模式
export type CronWakeMode = "next-heartbeat" | "now";

// Payload 类型
export type CronPayload =
  | { kind: "systemEvent"; text: string }  // 系统事件 (wake up)
  | {
      kind: "agentTurn";
      message: string;                     // Agent 消息
      model?: string;                      // 可选模型覆盖
      thinking?: string;                   // 可选 thinking 级别
      timeoutSeconds?: number;             // 超时
      deliver?: boolean;                   // 是否发送结果
      channel?: CronMessageChannel;        // 目标渠道
      to?: string;                         // 目标地址
    };

// 完整 Job 定义
export type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;           // 运行后删除
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  isolation?: CronIsolation;
  state: CronJobState;
};
```

---

## 7. Skills 系统

### 7.1 Skills 目录结构

```
skills/                         # 50+ bundled skills
├── 1password/
├── apple-notes/
├── apple-reminders/
├── bear-notes/
├── bird/                       # X/Twitter
├── blogwatcher/
├── brave-search/
├── camsnap/
├── clawdhub/
├── coding-agent/
├── discord/
├── food-order/
├── gemini/
├── gifgrep/
├── github/
├── gog/
├── goplaces/
├── himalaya/                   # Email
├── imsg/
├── local-places/
├── model-usage/
├── nano-banana-pro/
├── nano-pdf/
├── notion/
├── obsidian/
├── openai-image-gen/
├── openai-whisper/
├── openai-whisper-api/
├── openhue/
├── oracle/
├── ordercli/
├── peekaboo/
├── sag/                        # Speech
├── session-logs/
├── skill-creator/
├── slack/
├── songsee/
├── sonoscli/
├── spotify-player/
├── summarize/
├── things-mac/
├── tmux/
├── trello/
├── video-frames/
├── voice-call/
├── wacli/
└── weather/

每个 skill 目录包含:
├── SKILL.md                    # Skill 定义和说明
├── scripts/                    # 可选的脚本
└── ...                         # 其他资源
```

### 7.2 Skill 加载流程

```typescript
// src/agents/skills/workspace.ts

export async function loadWorkspaceSkillEntries(params: {
  cfg: ClawdbotConfig;
  agentId: string;
  workspaceDir: string;
}): Promise<SkillEntry[]> {
  
  // 1. 加载 bundled skills
  const bundledDir = resolveBundledSkillsDir();
  const bundledSkills = await loadSkillsFromDir(bundledDir);
  
  // 2. 加载 workspace skills
  const workspaceSkillsDir = path.join(params.workspaceDir, "skills");
  const workspaceSkills = await loadSkillsFromDir(workspaceSkillsDir);
  
  // 3. 加载 managed skills (可选)
  const managedSkills = await loadManagedSkills(params.cfg);
  
  // 4. 合并和去重
  const allSkills = mergeSkillEntries([bundledSkills, managedSkills, workspaceSkills]);
  
  // 5. 应用 allowlist/denylist
  const filtered = filterWorkspaceSkillEntries({
    entries: allSkills,
    config: params.cfg.agents?.defaults?.skills,
  });
  
  // 6. 检查 install requirements
  for (const skill of filtered) {
    if (skill.install) {
      skill.installStatus = await checkInstallRequirements(skill.install);
    }
  }
  
  return filtered;
}

// Skills Prompt 生成
export function resolveSkillsPromptForRun(params: {
  skills: SkillEntry[];
}): string {
  const skillLines = params.skills.map(skill => `
  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
    <location>${skill.location}</location>
  </skill>
  `);
  
  return `
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.

<available_skills>
${skillLines.join("\n")}
</available_skills>
`;
}
```

### 7.3 Skill 类型定义

```typescript
// src/agents/skills/types.ts

export interface SkillEntry {
  name: string;                    // 技能名称
  description: string;             // 技能描述
  location: string;                // SKILL.md 文件路径
  source: "bundled" | "managed" | "workspace";
  
  // 可选的安装要求
  install?: SkillInstallSpec;
  installStatus?: {
    satisfied: boolean;
    missing?: string[];
  };
  
  // 元数据
  metadata?: ClawdbotSkillMetadata;
}

export interface SkillInstallSpec {
  kind: "brew" | "npm" | "cargo" | "pip" | "uv";
  id?: string;
  label?: string;
  bins?: string[];                 // 需要的可执行文件
  formula?: string;                // Homebrew formula
  package?: string;                // npm/pip/cargo package
  module?: string;                 // Python module
}

export interface ClawdbotSkillMetadata {
  // SKILL.md frontmatter
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  install?: SkillInstallSpec | SkillInstallSpec[];
  config?: Record<string, unknown>;
}
```

---

## 8. Session 管理

### 8.1 Session Key 格式

```typescript
// src/routing/session-key.ts

// Session Key 格式:
// - "main"                           默认主 session
// - "global"                         全局 session (scope=global)
// - "agent:<agentId>:main"           指定 agent 的主 session
// - "group:<channel>:<groupId>"      群组 session
// - "agent:<agentId>:subagent:<uuid>" 子 agent session
// - "<channel>:<senderId>"           Per-sender session (scope=per-sender)

export function normalizeMainKey(key: string): string {
  // 规范化 session key
}

export function resolveAgentIdFromSessionKey(key: string): string {
  // 从 session key 提取 agent ID
}

export function deriveSessionKey(params: {
  cfg: ClawdbotConfig;
  provider?: string;
  from?: string;
  chatType?: string;
  groupId?: string;
  accountId?: string;
}): string {
  const scope = params.cfg.session?.scope ?? "per-sender";
  
  if (scope === "global") {
    return "global";
  }
  
  if (params.chatType === "group" && params.groupId) {
    return `group:${params.provider}:${params.groupId}`;
  }
  
  if (scope === "per-sender" && params.from) {
    return `${params.provider}:${params.from}`;
  }
  
  return resolveMainSessionKey(params.cfg);
}
```

### 8.2 Session Store 结构

```typescript
// src/config/sessions.ts

// Session Store 位置: ~/.clawdbot/sessions/<agentId>.json

export interface SessionEntry {
  messages: Message[];              // 对话历史
  updatedAt: number;                // 最后更新时间戳
  createdAt?: number;               // 创建时间戳
  
  // 可选覆盖
  modelOverride?: string;           // 模型覆盖 (provider/model)
  thinkLevel?: ThinkLevel;          // 思考级别 (off/low/medium/high)
  verboseLevel?: VerboseLevel;      // 详细级别
  reasoningLevel?: ReasoningLevel;  // 推理级别
  
  // 元数据
  label?: string;                   // 标签
  parentSession?: string;           // 父 session (subagent)
  
  // 上次交互信息
  lastTo?: string;                  // 上次发送目标
  lastProvider?: string;            // 上次使用的渠道
}

// Session Store 操作
export function loadSessionStore(storePath: string): Record<string, SessionEntry> {
  const content = fs.readFileSync(storePath, "utf-8");
  return JSON.parse(content);
}

export async function saveSessionStore(
  storePath: string, 
  store: Record<string, SessionEntry>
): Promise<void> {
  await fs.promises.writeFile(storePath, JSON.stringify(store, null, 2));
}

export function resolveStorePath(storeConfig?: string, opts?: { agentId?: string }): string {
  const agentId = opts?.agentId ?? "main";
  const stateDir = resolveStateDir();
  return path.join(stateDir, "sessions", `${agentId}.json`);
}
```

---

## 9. Browser/Canvas 扩展

### 9.1 Browser 控制

```typescript
// src/browser/client.ts

// 浏览器工具基于 Playwright

export async function browserStart(params: {
  baseUrl: string;
  profile?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> {
  // 启动浏览器实例
}

export async function browserStop(params: {
  baseUrl: string;
}): Promise<{ ok: boolean }> {
  // 停止浏览器实例
}

export async function browserSnapshot(params: {
  baseUrl: string;
  targetId?: string;
  format?: "aria" | "ai";
  compact?: boolean;
  maxChars?: number;
}): Promise<{ ok: boolean; snapshot?: string }> {
  // 获取页面快照 (DOM 结构)
}

export async function browserTabs(params: {
  baseUrl: string;
}): Promise<{ ok: boolean; tabs?: BrowserTab[] }> {
  // 列出所有标签页
}

// src/agents/tools/browser-tool.ts

export function createBrowserTool(opts: BrowserToolOptions): AnyAgentTool {
  return {
    label: "Browser",
    name: "browser",
    description: [
      "Control clawd's dedicated browser",
      "(status/start/stop/profiles/tabs/open/snapshot/screenshot/actions).",
      "Use snapshot+act for UI automation.",
    ].join(" "),
    parameters: BrowserToolSchema,
    execute: async (_toolCallId, args) => {
      const action = args.action;
      
      switch (action) {
        case "status": return await browserStatus({ baseUrl });
        case "start": return await browserStart({ baseUrl, profile });
        case "stop": return await browserStop({ baseUrl });
        case "tabs": return await browserTabs({ baseUrl });
        case "snapshot": return await browserSnapshot({ baseUrl, ...params });
        case "screenshot": return await browserScreenshotAction({ baseUrl, ...params });
        case "act": return await browserAct({ baseUrl, request: params.request });
        // ...
      }
    },
  };
}
```

### 9.2 Canvas (A2UI)

```typescript
// src/canvas-host/server.ts

// Canvas 是一个 Agent 可控的可视化工作区
// A2UI = Agent to UI 协议

export function startCanvasHost(params: {
  port: number;
  gatewayUrl: string;
  root?: string;
}): CanvasHostServer {
  const server = createServer((req, res) => {
    // 处理 Canvas 请求
    if (req.url?.startsWith(CANVAS_HOST_PATH)) {
      return handleCanvasRequest(req, res);
    }
  });
  
  // WebSocket 支持实时更新
  const wss = new WebSocketServer({ server });
  
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const cmd = JSON.parse(data.toString());
      handleCanvasCommand(ws, cmd);
    });
  });
  
  server.listen(params.port);
  
  return { server, wss };
}

// src/agents/tools/canvas-tool.ts

export function createCanvasTool(opts: CanvasToolOptions): AnyAgentTool {
  return {
    name: "canvas",
    description: "Control node canvases (present/hide/navigate/eval/snapshot/A2UI).",
    parameters: CanvasToolSchema,
    execute: async (_toolCallId, args) => {
      const action = args.action;
      
      switch (action) {
        case "present": 
          // 显示 Canvas
          return await canvasPresent({ url: args.url, node: args.node });
        
        case "hide":
          // 隐藏 Canvas
          return await canvasHide({ node: args.node });
        
        case "navigate":
          // 导航到 URL
          return await canvasNavigate({ url: args.url, node: args.node });
        
        case "eval":
          // 执行 JavaScript
          return await canvasEval({ javaScript: args.javaScript, node: args.node });
        
        case "snapshot":
          // 截图
          return await canvasSnapshot({ node: args.node, format: args.format });
        
        case "a2ui_push":
          // 推送 A2UI 指令
          return await canvasA2UIPush({ jsonl: args.jsonl, node: args.node });
        
        case "a2ui_reset":
          // 重置 A2UI
          return await canvasA2UIReset({ node: args.node });
      }
    },
  };
}
```

---

## 10. 其他重要机制

### 10.1 配置系统

```typescript
// src/config/zod-schema.ts

// 使用 Zod 进行配置验证

export const ClawdbotSchema = z.object({
  // 环境变量
  env: z.object({
    shellEnv: z.object({ enabled: z.boolean().optional() }).optional(),
    vars: z.record(z.string(), z.string()).optional(),
  }).optional(),
  
  // 日志配置
  logging: z.object({
    level: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  }).optional(),
  
  // Session 配置
  session: SessionSchema,
  
  // 渠道配置
  channels: ChannelsSchema,
  
  // Agent 配置
  agents: AgentsSchema,
  
  // 工具配置
  tools: ToolsSchema,
  
  // 插件配置
  plugins: PluginsSchema,
  
  // 网关配置
  gateway: z.object({
    port: z.number().int().positive().optional(),
    bind: z.enum(["auto", "lan", "tailnet", "loopback"]).optional(),
    auth: z.object({ token: z.string().optional() }).optional(),
  }).optional(),
  
  // Hooks 配置
  hooks: z.object({
    gmail: HooksGmailSchema,
    mapping: HookMappingSchema,
  }).optional(),
  
  // Talk (语音) 配置
  talk: z.object({
    voiceId: z.string().optional(),
    modelId: z.string().optional(),
  }).optional(),
  
  // ...更多配置项
});
```

### 10.2 Memory Search

```typescript
// src/memory/manager.ts

export class MemoryIndexManager {
  private db: DatabaseSync;
  private provider: EmbeddingProvider;
  private watcher: FSWatcher | null = null;
  
  static async get(params: {
    cfg: ClawdbotConfig;
    agentId: string;
  }): Promise<MemoryIndexManager | null> {
    const settings = resolveMemorySearchConfig(params.cfg, params.agentId);
    if (!settings) return null;
    
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
    const provider = await createEmbeddingProvider({ config: params.cfg });
    
    return new MemoryIndexManager({ settings, workspaceDir, provider });
  }
  
  async search(query: string, opts?: {
    maxResults?: number;
    minScore?: number;
  }): Promise<MemorySearchResult[]> {
    // 1. 确保索引是最新的
    await this.sync();
    
    // 2. 获取查询向量
    const queryVec = await this.provider.embedQuery(query);
    
    // 3. 搜索相似片段
    const candidates = this.listChunks();
    const scored = candidates.map(chunk => ({
      chunk,
      score: cosineSimilarity(queryVec, chunk.embedding),
    }));
    
    // 4. 过滤和排序
    return scored
      .filter(entry => entry.score >= (opts?.minScore ?? this.settings.query.minScore))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts?.maxResults ?? this.settings.query.maxResults);
  }
  
  async sync(): Promise<void> {
    // 扫描 MEMORY.md 和 memory/*.md
    // 对变化的文件重新建立索引
  }
}
```

### 10.3 Plugin 系统

```typescript
// src/plugins/loader.ts

export function loadClawdbotPlugins(options: PluginLoadOptions): PluginRegistry {
  const cfg = options.config ?? {};
  const normalized = normalizePluginsConfig(cfg.plugins);
  
  // 1. 发现插件
  const discovery = discoverClawdbotPlugins({
    workspaceDir: options.workspaceDir,
    extraPaths: normalized.loadPaths,
  });
  
  // 2. 创建 jiti 加载器 (支持 TypeScript)
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  
  const registry = createPluginRegistry();
  
  for (const candidate of discovery.candidates) {
    // 3. 检查启用状态
    const enableState = resolveEnableState(candidate.idHint, normalized);
    if (!enableState.enabled) continue;
    
    // 4. 加载模块
    const mod = jiti(candidate.source);
    const { definition, register } = resolvePluginModuleExport(mod);
    
    if (!register) continue;
    
    // 5. 验证配置
    const validatedConfig = validatePluginConfig({
      schema: definition?.configSchema,
      value: normalized.entries[candidate.idHint]?.config,
    });
    
    // 6. 注册插件
    const api = createPluginApi(registry, {
      config: cfg,
      pluginConfig: validatedConfig.value,
    });
    
    register(api);
  }
  
  return registry;
}

// Plugin API
interface PluginApi {
  registerTool(tool: AgentTool): void;
  registerGatewayMethod(name: string, handler: GatewayRequestHandler): void;
  registerCliCommand(cmd: Command): void;
  registerChannel(plugin: ChannelPlugin): void;
  
  config: ClawdbotConfig;
  pluginConfig: Record<string, unknown>;
  logger: PluginLogger;
}
```

---

## 总结

### 核心亮点

1. **完整的 TypeScript 实现**: 1,279 个源文件，约 268,658 行代码，全面使用 TypeScript 严格模式
2. **模块化架构**: 清晰的分层设计，各模块职责明确，通过接口解耦
3. **泛型 Channel Plugin 系统**: `ChannelPlugin<T>` 统一的渠道抽象，易于扩展新平台
4. **强大的 Agent 运行时**: 基于 `@mariozechner/pi-coding-agent`，支持 failover、队列调度、session 压缩
5. **丰富的工具集**: 覆盖文件、命令、浏览器、消息、节点等多种场景
6. **Zod 类型安全配置**: 运行时验证 + 编译时类型推断
7. **多层安全机制**: DM pairing、allowFrom、elevated 权限等

### 技术栈

- **语言**: TypeScript (ESM, 严格模式)
- **运行时**: Node.js ≥22 / Bun
- **构建**: tsc
- **测试**: Vitest + V8 Coverage
- **Lint/Format**: Oxlint + Oxfmt
- **CLI**: Commander.js + @clack/prompts
- **AI 引擎**: @mariozechner/pi-coding-agent
- **消息平台**: grammY, Baileys, discord.js, @slack/bolt, botbuilder
- **浏览器自动化**: Playwright
- **验证**: Zod + @sinclair/typebox + Ajv
- **日志**: pino

### 数据流

```
用户消息
    │
    ▼
Channel Plugin (接收/解析)
    │
    ▼
Security Check (pairing/allowFrom)
    │
    ▼
auto-reply/reply/get-reply.ts (核心入口)
    │
    ├─▶ 命令处理 (/help, /status, /reset)
    │
    └─▶ agents/pi-embedded-runner/run.ts (Agent 运行)
            │
            ├─▶ 队列调度 (sessionLane + globalLane)
            │
            ├─▶ 认证解析 (auth profiles, failover)
            │
            ├─▶ @mariozechner/pi-coding-agent
            │       │
            │       ├─▶ System Prompt
            │       ├─▶ Tools 执行
            │       └─▶ 流式输出
            │
            └─▶ Session 保存
    │
    ▼
Response Delivery (分块/媒体/reply tags)
    │
    ▼
Channel Plugin (发送)
    │
    ▼
用户收到回复
```

---

*报告基于 TypeScript 源码分析，完成于 2026-01-15*
