# OwliaBot Telegram 设置指南

## 1. 创建 Telegram Bot

1. 在 Telegram 中搜索并打开 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 命令
3. 输入你的 Bot 显示名称（例如：`My OwliaBot`）
4. 输入 Bot 用户名（必须以 `bot` 结尾，例如：`my_owliabot_bot`）
5. BotFather 会返回一个 **HTTP API Token**，格式如：`123456789:ABCdefGhIjKlMnOpQrStUvWxYz`
6. **复制并保存这个 Token**，稍后配置时需要用到

## 2. 设置 Bot 信息（可选）

在 BotFather 中可以进一步设置：

- `/setdescription` — 设置 Bot 描述（用户首次打开对话时看到）
- `/setabouttext` — 设置 Bot 简介
- `/setuserpic` — 设置 Bot 头像
- `/setcommands` — 设置命令菜单

## 3. 获取你的 User ID

OwliaBot 支持配置用户白名单（`allowList`），只允许指定用户与 Bot 交互。

获取你的 Telegram User ID：

1. 在 Telegram 中搜索并打开 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息，Bot 会返回你的 User ID（纯数字）
3. 在 OwliaBot 配置中填入这个 ID

## 4. 群组隐私模式设置

默认情况下，Telegram Bot 在群组中**只能收到以 `/` 开头的命令和 @提及消息**。

如果你希望 Bot 能读取群组中的所有消息：

1. 在 BotFather 中发送 `/mybots`
2. 选择你的 Bot
3. 选择 **Bot Settings** → **Group Privacy**
4. 选择 **Turn off**

> ⚠️ 关闭隐私模式后，Bot 可以读取群组中的所有消息。请确保你信任该 Bot 的代码。

## 5. 在 OwliaBot 中配置

运行 OwliaBot 的 onboard 向导时，选择 Telegram 平台并粘贴你的 Bot Token 即可。

或者手动编辑 `secrets.yaml`：

```yaml
telegram:
  token: "你的Bot Token"
```

在 `app.yaml` 中配置白名单：

```yaml
telegram:
  allowList:
    - "你的User ID"
```
