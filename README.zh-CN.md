# OwliaBot（中文说明）

自托管、crypto-native、以安全为先的 AI Agent。

[![English](https://img.shields.io/badge/English-lightgrey)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue)](README.zh-CN.md)

## 为什么选择 OwliaBot？

- **安全优先**：私钥永远不会进入机器人进程
- **自托管**：完全运行在你自己的机器或服务器上
- **可扩展**：通过 JavaScript Skills 扩展能力
- **熟悉的交互方式**：通过 Telegram 或 Discord 对话

OwliaBot 使用三层安全模型：

| 层级 | 描述 | 使用场景 |
|------|------|----------|
| 第 1 层 | 伴生 App（需用户确认） | 大额/不可逆交易 |
| 第 2 层 | 会话密钥（限额、可轮换） | 小额自动化操作 |
| 第 3 层 | 智能合约钱包 | 细粒度链上权限控制 |

## 功能特性

- 面向 Crypto 原生用户与团队的风险工作流
- 覆盖 X（Twitter）、Telegram 等来源的信号监控
- 面向地址与仓位的链上风险体检
- 多 AI 提供商按优先级回退（Anthropic、OpenAI）
- 支持 Telegram 与 Discord 渠道接入
- Gateway HTTP 服务器：设备配对与远程工具调用
- 系统能力：`exec`、`web.fetch`、`web.search`
- 记忆子系统（SQLite 索引）
- 审计日志（fail-closed 设计）

## 快速开始

### 不克隆仓库：直接运行 Go Onboard 二进制（默认 preview）

如果你只想运行引导向导，不想先 clone 代码：

```bash
curl -sSL https://raw.githubusercontent.com/owliabot/owliabot/main/onboard.sh | bash
```

如果要使用 stable 通道：

```bash
curl -sSL https://raw.githubusercontent.com/owliabot/owliabot/main/onboard.sh | OWLIABOT_ONBOARD_CHANNEL=stable bash
```

### 环境要求

- Node.js >= 22
- Telegram Bot token（来自 @BotFather）或 Discord Bot token
- AI 提供商 API key（Anthropic、OpenAI）— 或使用 Claude 订阅 OAuth

### 1. 克隆并安装

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
npm install
```

### 2. 运行交互式设置（推荐）

```bash
npx tsx src/entry.ts onboard
```

引导流程会依次询问：
- 启用的频道（Discord / Telegram）
- 时区（自动检测，可在配置中覆盖）
- AI 模型选择
- 可选的 OAuth 认证
- 频道 Token 配置

配置保存至 `$OWLIABOT_HOME/app.yaml`（默认：`~/.owliabot/app.yaml`），敏感信息存入 `$OWLIABOT_HOME/secrets.yaml`。

### 3. 启动机器人

```bash
npx tsx src/entry.ts start
```

或指定配置文件路径：

```bash
npx tsx src/entry.ts start -c /path/to/config.yaml
```

给机器人发一条消息，应该就能收到回复！

## 手动配置（备选）

如果你更喜欢手动设置：

```bash
cp config.example.yaml config.yaml
# 编辑 config.yaml，填入 API key 和 token
npx tsx src/entry.ts start -c config.yaml
```

## CLI 命令

所有命令使用 `npx tsx src/entry.ts <command>` 格式：

| 命令 | 描述 |
|------|------|
| `start` | 启动机器人 |
| `doctor` | 诊断启动失败（配置/Token）并引导修复 |
| `onboard` | 交互式设置向导 |
| `auth setup [provider]` | 设置 OAuth（anthropic 或 openai-codex） |
| `auth status [provider]` | 检查认证状态 |
| `auth logout [provider]` | 清除已存储的凭据 |
| `token set <channel>` | 从环境变量设置频道 token |
| `pair` | 与 Gateway HTTP 配对设备 |

### 示例

```bash
# 交互式设置
npx tsx src/entry.ts onboard

# 诊断启动问题（配置错误 / Token 格式错误）
npx tsx src/entry.ts doctor

# Docker 模式诊断（容器内执行）
docker exec -it owliabot owliabot doctor

# 使用默认配置启动（$OWLIABOT_HOME/app.yaml，默认：~/.owliabot/app.yaml）
npx tsx src/entry.ts start

# 使用自定义配置启动
npx tsx src/entry.ts start -c config.yaml

# 设置 Claude OAuth
npx tsx src/entry.ts auth setup anthropic

# 检查认证状态
npx tsx src/entry.ts auth status

# 从环境变量设置 Discord token
DISCORD_BOT_TOKEN=xxx npx tsx src/entry.ts token set discord

# 与 gateway 配对设备
OWLIABOT_GATEWAY_TOKEN=xxx npx tsx src/entry.ts pair --device-id my-device
```

## Gateway HTTP 服务器

OwliaBot 包含一个 HTTP 网关，用于设备配对和远程工具调用：

```yaml
# 在 config.yaml 中
gateway:
  http:
    port: 8787
    token: ${OWLIABOT_GATEWAY_TOKEN}
    allowlist:
      - "127.0.0.1"
      - "10.0.0.0/8"
```

**端点：**
- `GET /health` — 健康检查
- `POST /command/system` — 系统能力（web.fetch、web.search、exec）
- `POST /command/tool` — 工具调用
- `POST /pair/*` — 设备配对流程

## 内置 Skills

- `crypto-price`：从 CoinGecko 查询价格（无需 API key）
- `crypto-balance`：跨链查询钱包余额（需要 `ALCHEMY_API_KEY`）

示例提问：
- "比特币现在价格是多少？"
- "查询 0x... 在 ethereum 上的余额"

## 配置参考

配置文件的关键部分：

| 字段 | 描述 |
|------|------|
| `providers` | AI 提供商，支持优先级回退 |
| `telegram` | Telegram bot token 和 allowList |
| `discord` | Discord bot token、guild 设置、@提及规则 |
| `workspace` | 工作区路径（默认 `./workspace`） |
| `gateway.http` | 设备配对 HTTP 服务器 |
| `notifications` | 主动消息发送目标 |
| `heartbeat` | 基于 cron 的定时任务 |
| `system` | 系统能力（exec、web）策略 |

完整选项请参考 [`config.example.yaml`](./config.example.yaml)。

## 开发

```bash
# 开发模式（热重载）
npm run dev -- start -c config.yaml

# 类型检查
npm run typecheck

# 运行测试
npm test

# 测试监听模式
npm run test:watch

# 代码检查
npm run lint

# 生产构建
npm run build
npm run start -- start -c config.yaml
```

## 项目结构

```
src/
├── entry.ts           # CLI 入口
├── config/            # 配置 schema 与加载器
├── channels/          # Telegram / Discord 渠道接入
├── agent/             # Agent 运行时、会话、工具
├── gateway/           # 消息网关
├── gateway/http/      # 设备配对 HTTP 服务器
├── security/          # WriteGate、Tier 策略、审计
├── memory/            # 记忆搜索与索引
├── workspace/         # 工作区加载器
└── skills/            # Skills 系统
```

## 文档

- [配置与验证指南](docs/setup-verify.md)
- [Gateway HTTP 设计](docs/architecture/gateway-design.md)
- [系统能力](docs/architecture/system-capability.md)
- [Tier 策略与安全](docs/design/tier-policy.md)
- [审计策略](docs/design/audit-strategy.md)

## 常见问题排查

| 问题 | 解决方案 |
|------|----------|
| 启动失败 | 检查配置 YAML 语法和必填字段 |
| "Node.js version" 报错 | 升级至 Node.js >= 22 |
| 机器人不响应 | 检查 allowList 是否包含你的用户 ID |
| OAuth 过期 | 重新运行 `npx tsx src/entry.ts auth setup` |
| Discord 群内静默 | 检查 `requireMentionInGuild` 设置和频道白名单 |

## License

MIT
