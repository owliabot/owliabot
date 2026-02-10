# OwliaBot 配置与验证指南

## 前置条件

| 依赖 | 要求 |
|------|------|
| Node.js | **>= 22.0.0** |
| npm | 随 Node.js 一起安装即可 |
| AI 提供商密钥 | Anthropic API Key（推荐）或 OpenAI API Key |
| 频道令牌 | Discord Bot Token 和/或 Telegram Bot Token（至少一个） |

> **提示：** 如果你有 Claude 订阅，也可以通过 OAuth 认证代替 API Key，详见下方说明。

---

## 快速安装

### 1. 克隆并安装依赖

```bash
git clone https://github.com/owliabot/owliabot.git
cd owliabot
npm install
```

### 2. 生成配置（二选一）

#### 方式 A：交互式引导（推荐）

```bash
npx tsx src/entry.ts onboard
```

引导流程会依次询问：
- 启用的频道（discord / telegram）
- 时区（Timezone）
- Anthropic 模型（默认 `claude-sonnet-4-5`）
- 是否立即执行 OAuth 认证
- Discord / Telegram 的 Token 和频道配置

完成后配置写入 `$OWLIABOT_HOME/app.yaml`（默认：`~/.owliabot/app.yaml`），敏感令牌存入 `$OWLIABOT_HOME/secrets.yaml`。

#### 方式 B：手动复制模板

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，填入你的 API Key 和 Token。支持环境变量引用（如 `${ANTHROPIC_API_KEY}`）。

---

## 配置参考

`config.example.yaml` 包含完整选项，以下为核心字段简要说明：

### `providers` — AI 模型提供商

```yaml
providers:
  - id: anthropic
    model: claude-sonnet-4-5
    apiKey: ${ANTHROPIC_API_KEY}   # 或填 "oauth" 使用 OAuth 认证
    priority: 1
  - id: openai
    model: gpt-4o
    apiKey: ${OPENAI_API_KEY}
    priority: 2
```

可配置多个提供商，按 `priority` 顺序回退。

> **OAuth 认证**：运行 `npx tsx src/entry.ts auth setup` 完成浏览器授权后，将 `apiKey` 设为 `oauth` 即可使用 Claude 订阅额度。

### `discord` — Discord 集成

```yaml
discord:
  token: ${DISCORD_BOT_TOKEN}
  requireMentionInGuild: true          # 默认 true：需要 @提及 才回复
  channelAllowList:                    # 白名单频道（仅 requireMentionInGuild: false 时生效）
    - "1467915124764573736"            # 设为 false 后，仅允许白名单频道中的消息
  memberAllowList:                     # 允许与 bot 对话的用户 ID
    - "123456789012345678"
```

### `telegram` — Telegram 集成

```yaml
telegram:
  token: ${TELEGRAM_BOT_TOKEN}
  allowList:                           # 允许的 Telegram 用户 ID
    - "883499266"
```

### 其他字段

| 字段 | 说明 |
|------|------|
| `workspace` | 工作空间路径，默认 `./workspace` |
| `notifications.channel` | 主动通知目标，格式如 `telegram:883499266` |
| `heartbeat` | 定时任务，`enabled: true` + `cron` 表达式 |
| `gateway.http` | HTTP 网关（可选），含速率限制、IP 白名单等 |

完整选项请参考 [`config.example.yaml`](../config.example.yaml)。

---

## 验证步骤

按以下顺序逐步验证，确保环境和配置正确。

### ① 类型检查

```bash
npm run typecheck
```

预期：无报错，退出码 0。如果失败，通常是 Node 版本过低或依赖未安装。

### ② 运行测试

```bash
npm test
```

预期：所有测试用例通过（绿色）。

### ③ 启动 Bot

```bash
# 使用 onboard 生成的配置（默认路径）
npm run dev -- start

# 或指定配置文件
npm run dev -- start -c config.yaml
```

预期日志输出：

```
Starting OwliaBot...
OwliaBot is running. Press Ctrl+C to stop.
```

如果配置了 Discord，还会看到 Discord 客户端连接成功的日志。

### ④ Discord 验证

1. 确保 Bot 已被邀请到你的 Discord 服务器，且拥有「读取消息」「发送消息」权限。
2. 在 `channelAllowList` 中的频道，或任意频道中 @提及 Bot：

   ```
   @Owlia 你好
   ```

3. 预期：Bot 回复 LLM 生成的内容（响应可能需要几秒）。

### ⑤ Telegram 验证（如已配置）

1. 在 Telegram 中找到你的 Bot（通过 @BotFather 创建时的用户名）。
2. 发送任意消息，如：

   ```
   你好
   ```

3. 预期：Bot 回复 LLM 生成的内容。

---

## 常见问题排查

### Bot 启动失败

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `config validation failed` | 配置文件格式错误或缺少必填字段 | 对照 `config.example.yaml` 检查 YAML 语法和字段名 |
| `DISCORD_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN` 未定义 | 环境变量未设置 | `export DISCORD_BOT_TOKEN="你的token"` 或在 yaml 中直接写入值 |
| `ANTHROPIC_API_KEY` 未定义 | 未提供 AI 提供商密钥 | 设置环境变量，或使用 `owliabot auth setup` 进行 OAuth 认证 |
| `Node.js version` 报错 | Node 版本 < 22 | 升级 Node.js：`nvm install 22 && nvm use 22` |

### Discord Bot 不回复

- **未 @提及**：默认 `requireMentionInGuild: true`，在非白名单频道需要 @提及 Bot。
- **频道 ID 错误**：`channelAllowList` 中的 ID 必须是频道 ID（非服务器 ID）。开启 Discord 开发者模式后右键频道 → 复制 ID。
- **Bot 权限不足**：确保 Bot 在目标频道有「查看频道」「发送消息」「读取消息历史」权限。
- **memberAllowList 未包含你的 ID**：如果设置了此字段，确保你的 Discord 用户 ID 在列表中。
- **MESSAGE CONTENT INTENT 未开启**：在 Discord Developer Portal → Bot → Privileged Gateway Intents 中开启。
- **Thread 中不回复**：需要勾选「Send Messages in Threads」权限，并重新邀请 Bot。

> 📖 详细的 Discord 设置指南请参考 [Discord Setup Guide](discord-setup.md)

### OAuth 过期

```bash
# 检查 OAuth 状态
npx tsx src/entry.ts auth status

# 重新认证
npx tsx src/entry.ts auth setup

# 清除凭据重来
npx tsx src/entry.ts auth logout
```

OAuth Token 会自动刷新，但如果长时间未使用可能失效，需重新运行 `auth setup`。

### Telegram Bot 不回复

- **allowList 未配置你的用户 ID**：在 Telegram 中发送 `/start` 给 @userinfobot 获取你的数字 ID。
- **Token 无效**：确认 Token 来自 @BotFather，且未被 revoke。

### 其他调试技巧

- 查看详细日志：Bot 使用 `tslog`，启动时会输出配置加载和连接状态信息。
- 使用 `npm run dev` 启动（watch 模式），修改代码后自动重启，方便调试。
- 令牌管理：可使用 `npx tsx src/entry.ts token set discord` / `npx tsx src/entry.ts token set telegram` 从环境变量写入 `$OWLIABOT_HOME/secrets.yaml`。
