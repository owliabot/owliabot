# OwliaBot（中文说明）

自托管、crypto-native、以安全为先的 AI Agent。

[![English](https://img.shields.io/badge/English-lightgrey)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue)](README.zh-CN.md)

## 为什么选择 OwliaBot？

- 安全优先：私钥永远不会进入机器人进程。
- 自托管：完全运行在你自己的机器或服务器上。
- 可扩展：通过 JavaScript Skills 扩展能力。
- 熟悉的交互方式：通过 Telegram 或 Discord 对话。

OwliaBot 使用三层安全模型：

- 第 1 层：伴生 App（需要用户确认的交易）
- 第 2 层：会话密钥（小额自动化操作）
- 第 3 层：智能合约钱包（大额自动化操作，且可细粒度授权）

## 功能特性

- 面向 Crypto 原生用户与团队的风险工作流。
- 覆盖 X（Twitter）、Telegram 等来源的信号监控与归因。
- 面向地址与仓位的链上风险体检。
- 面向借贷、LP 等 DeFi 仓位的持续风险信号监控。
- 用自然语言解释复杂的 DeFi 风险指标。
- 多 AI 提供商按优先级回退（Anthropic、OpenAI）。
- 支持 Telegram 与 Discord 渠道接入。
- 基于 YAML 的配置，支持环境变量注入。
- 支持 Claude 订阅 OAuth 鉴权流程。
- 支持工作区加载与基于 cron 的心跳任务。

## 快速开始

### 环境要求

- Node.js >= 22
- Telegram Bot token（来自 @BotFather）或 Discord Bot token
- 任意 AI 提供商的 API key（Anthropic、OpenAI 等）

### 1. 安装依赖

```bash
npm install
```

### 2. 复制配置模板

```bash
cp config.example.yaml config.yaml
```

### 3. 最小可用配置

编辑 `config.yaml`：

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

你也可以使用 Discord 配置替代 Telegram。

### 4. 启动机器人

```bash
npm run dev -- start -c config.yaml
```

给机器人发一条消息，应该就能收到回复。

## 内置 Skills

OwliaBot 内置了一些技能帮助你快速上手：

- `crypto-price`：从 CoinGecko 查询价格（无需 API key）
- `crypto-balance`：跨链查询钱包余额（需要 `ALCHEMY_API_KEY`）

示例提问：

- “比特币现在价格是多少？”
- “查询 0x... 在 ethereum 上的余额”

启用 `crypto-balance` 需要设置：

```bash
export ALCHEMY_API_KEY="your-key-here"
```

## 配置说明（重点字段）

`config.yaml` 关键部分：

- `providers`：一个或多个 AI 提供商，可选 `priority`
- `telegram` / `discord`：渠道 token 与可选 `allowList`
- `workspace`：工作区路径（默认 `./workspace`）
- `skills.enabled` 与 `skills.directory`：Skills 系统开关与路径
- `notifications.channel`：主动消息发送位置（例如 `telegram:883499266`）
- `heartbeat`：基于 cron 的定时任务
- `session`：私聊（DM）会话范围
  - **说明：** DM 会被视为同一个“主会话桶”（不是按发送者区分）。这是为单人 allowlist 的部署形态设计的。
  - `session.mainKey`：DM 主会话桶名称（默认 `main`）
  - `session.scope`：`per-agent`（默认）或 `global`
- `group.activation`：群聊激活模式
  - `mention`（默认）：仅在 `ctx.mentioned=true`（明确触发）或在 allowlist 群/频道内时响应
    - Discord：@机器人时会设置 `ctx.mentioned=true`
    - Telegram 群：满足以下任一会设置 `ctx.mentioned=true`：回复机器人消息 / 文本里 @botusername / 使用 /command（可选 /command@bot）
  - `always`：在群聊中响应所有消息（建议配合 allowlist 防止刷屏）

常用环境变量：

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `ALCHEMY_API_KEY`

### （可选）Claude OAuth

如果你想使用 Claude 订阅 OAuth（而不是 API key）：

```bash
npm run dev -- auth setup
```

然后在 `config.yaml` 中这样配置 Anthropic provider：

```yaml
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: oauth
    priority: 1
```

## 项目结构

- `src/entry.ts`：CLI 入口（`owliabot`）
- `src/config/*`：配置 schema、类型与加载逻辑
- `src/channels/*`：Telegram / Discord 渠道接入
- `src/agent/*`：Agent 运行时、会话与工具体系
- `src/workspace/*`：工作区加载与记忆搜索
- `config.example.yaml`：配置模板

## 文档索引（源码路径）

以下文档是仓库内的权威参考：

- `docs/src/content/docs/zh/getting-started/introduction.md`
- `docs/src/content/docs/zh/getting-started/quick-start.md`
- `docs/src/content/docs/zh/reference/configuration.md`
- `docs/src/content/docs/zh/architecture/overview.md`
- `docs/src/content/docs/zh/architecture/security.md`
- `docs/src/content/docs/zh/skills/builtin-skills.md`
- `docs/src/content/docs/zh/skills/creating-skills.md`

## 架构说明（仓库内）

- `docs/architecture/gateway-design.md`
- `docs/architecture/gateway-functional.md`
- `docs/architecture/gateway-technical.md`
- `docs/architecture/playwright-mcp.md`
- `docs/architecture/system-capability.md`

## 常用命令

```bash
npm run dev -- start -c config.yaml   # 开发/监听模式运行
npm run build                         # 编译 TypeScript
npm run start -- start -c config.yaml # 运行编译产物
npm run lint                          # 运行 ESLint
npm run typecheck                     # TypeScript 类型检查
npm run test                          # 运行测试（单次）
npm run test:watch                    # 运行测试（监听模式）
```

## 常见问题排查

- 启动失败时，优先检查 `config.yaml` 是否正确且完整。
- 确保环境变量在当前 shell 会话中可见。
- Node.js 版本需 >= 22。
