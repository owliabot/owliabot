# OwliaBot（中文说明）

面向 Crypto 原生的安全的 AI Agent。

[![English](https://img.shields.io/badge/English-lightgrey)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue)](README.zh-CN.md)

## OwliaBot 介绍

OwliaBot 是一个 **开源、社区友好** 的 Crypto AI Agent。

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

## 环境要求

- Node.js >= 22.0.0
- npm >= 10（建议）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置机器人

1. 复制示例配置：

```bash
cp config.example.yaml config.yaml
```

2. 在 `config.yaml` 中填写 providers、渠道 token、notifications 等配置。
3. 设置必要的环境变量（示例）：

```bash
export ANTHROPIC_API_KEY="你的 ANTHROPIC Key"
export OPENAI_API_KEY="你的 OPENAI Key"
export TELEGRAM_BOT_TOKEN="你的 Telegram Bot Token"
export DISCORD_BOT_TOKEN="你的 Discord Bot Token"
```

### 3.（可选）使用 Claude OAuth

如果你希望使用 Claude 订阅 OAuth（而不是 API Key）：

```bash
npm run dev -- auth setup
```

然后在 `config.yaml` 中将 Anthropic provider 配置为：

```yaml
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: oauth
    priority: 1
```

### 4. 启动机器人

开发模式：

```bash
npm run dev -- start -c config.yaml
```

构建并运行（接近生产环境）：

```bash
npm run build
npm run start -- start -c config.yaml
```

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

## 配置说明

`config.yaml` 重点字段：

- `providers`：AI 提供商与优先级顺序。
- `telegram` / `discord`：渠道 token 与可选 allowList。
- `notifications.channel`：主动通知发送位置（如 `telegram:883499266`）。
- `workspace`：工作区数据路径（默认 `./workspace`）。
- `heartbeat`：基于 cron 的心跳配置。

## 项目结构

- `src/entry.ts`：CLI 入口（`owliabot`）。
- `src/config/*`：配置 schema、类型与加载逻辑。
- `src/channels/*`：Telegram / Discord 渠道接入。
- `src/agent/*`：Agent 运行时、会话与工具体系。
- `src/workspace/*`：工作区加载与记忆搜索。
- `config.example.yaml`：配置模板。

## 常见问题排查

- 启动失败时，优先检查 `config.yaml` 是否填写完整且格式正确。
- 确保环境变量在当前 shell 会话中可见。
- Node.js 版本需 >= 22。
