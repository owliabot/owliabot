# OwliaBot Discord 设置指南

## 1. 创建 Discord Application

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 **New Application**
3. 输入应用名称（如 `OwliaBot`）
4. 点击 **Create**

---

## 2. Bot 设置

进入 **Bot** 页面：

### 2.1 基本设置
- **Username**: 设置 bot 的显示名称
- 点击 **Reset Token** 获取 Bot Token（⚠️ 只显示一次，妥善保存）

### 2.2 Authorization Flow
| 选项 | 建议 | 说明 |
|------|------|------|
| Public Bot | ✅ 开启 | 允许他人添加 bot 到服务器 |
| Requires OAuth2 Code Grant | ❌ 关闭 | 除非需要 OAuth2 流程 |

### 2.3 Privileged Gateway Intents ⚠️ 重要

| Intent | 必须 | 说明 |
|--------|------|------|
| Presence Intent | ❌ 可选 | 接收用户在线状态变化 |
| Server Members Intent | ❌ 可选 | 接收成员加入/离开事件 |
| **Message Content Intent** | ✅ **必须开启** | **接收消息内容，不开则收不到用户消息** |

### 2.4 Bot Permissions

在 **Bot Permissions** 部分勾选以下权限：

#### General Permissions
- [x] **View Channels** — 查看频道

#### Text Permissions
- [x] **Send Messages** — 发送消息
- [x] **Send Messages in Threads** — ⚠️ **在 thread 中发送消息（必须勾选！）**
- [x] **Read Message History** — 读取消息历史
- [x] **Manage Messages** — 管理消息（可选，用于删除自己的消息）
- [x] **Embed Links** — 嵌入链接（可选，用于富文本）
- [x] **Attach Files** — 附加文件（可选）
- [x] **Add Reactions** — 添加反应（可选）

---

## 3. 生成邀请链接

进入 **OAuth2** → **URL Generator** 页面：

### 3.1 Scopes
勾选：
- [x] **bot**
- [x] **applications.commands** （可选，如果使用 slash commands）

### 3.2 Bot Permissions
勾选与上面相同的权限：
- [x] View Channels
- [x] Send Messages
- [x] **Send Messages in Threads**
- [x] Read Message History
- [x] Manage Messages
- [x] Embed Links
- [x] Attach Files
- [x] Add Reactions

### 3.3 复制链接
页面底部会生成一个 URL，格式如：
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878024768&scope=bot
```

点击这个链接，选择要添加的服务器。

---

## 4. 配置 OwliaBot

在 `$OWLIABOT_HOME/app.yaml`（默认：`~/.owliabot/app.yaml`）或 `config.yaml` 中配置：

```yaml
discord:
  token: YOUR_BOT_TOKEN_HERE
  requireMentionInGuild: true  # 在服务器中需要 @提及 才回复
  # memberAllowList:           # 可选：限制只有特定用户可以使用
  #   - "123456789012345678"
  # channelAllowList:          # 可选：限制只在特定频道响应
  #   - "987654321098765432"
```

---

## 5. 常见问题

### Bot 收不到消息
1. **检查 Message Content Intent** — 必须在 Developer Portal 开启
2. **检查权限** — bot 需要 View Channels + Read Message History
3. **检查 Thread 权限** — 如果在 thread 中使用，需要 Send Messages in Threads

### Bot 不回复
1. **检查 requireMentionInGuild** — 如果为 `true`，需要 @提及 bot
2. **检查 memberAllowList** — 如果配置了，确保你的 user ID 在列表中
3. **检查 channelAllowList** — 如果配置了，确保频道 ID 正确

### 如何获取 User ID / Channel ID
1. 在 Discord 设置中开启 **Developer Mode**（用户设置 → 高级 → 开发者模式）
2. 右键点击用户/频道 → **Copy ID**

---

## 6. 权限计算器

最小必要权限值：`274878024768`

包含：
- View Channels (1024)
- Send Messages (2048)
- Send Messages in Threads (274877906944)
- Read Message History (65536)
- Manage Messages (8192)

邀请链接示例：
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878024768&scope=bot
```

---

## 7. 检查清单

在启动 bot 前确认：

- [ ] Message Content Intent 已开启
- [ ] Bot Token 已复制到配置文件
- [ ] Bot 已被邀请到目标服务器
- [ ] Bot 有 View Channels 权限
- [ ] Bot 有 Send Messages 权限
- [ ] Bot 有 Send Messages in Threads 权限（如果使用 thread）
- [ ] Bot 有 Read Message History 权限
