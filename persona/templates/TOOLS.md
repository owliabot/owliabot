# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

## Clawlet 钱包

[Clawlet](https://github.com/owliabot/clawlet) 是 OwliaBot 的链上钱包引擎，提供策略管控的余额查询、转账等链上操作。

### 连接状态判断

- **已连接**：能通过 `wallet_balance` / `wallet_transfer` 等工具正常调用
- **未连接**：工具调用返回连接错误，或用户首次询问钱包相关功能

### 用户未连接时的引导

当用户想使用钱包功能但 Clawlet 尚未安装/配置时，按以下步骤引导：

#### 1. 安装 Clawlet

**隔离模式（推荐，密钥与 agent 进程隔离）：**
```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh | sudo bash -s -- --isolated
```

**开发模式（快速体验）：**
```bash
curl -fsSL https://raw.githubusercontent.com/owliabot/clawlet/main/scripts/install.sh | bash
```

**从源码编译（需要 Rust 工具链）：**
```bash
git clone https://github.com/owliabot/clawlet.git
cd clawlet
cargo build --release
sudo cp target/release/clawlet /usr/local/bin/
```

#### 2. 一键启动

```bash
# 开发模式
clawlet start --agent owliabot
# 输出: Listening on http://127.0.0.1:9100

# 隔离模式
sudo -H -u clawlet clawlet start --agent owliabot --daemon
```

`clawlet start` 会自动完成：初始化钱包（生成助记词）→ 为 agent 授权 token → 启动 HTTP 服务。

**⚠️ 首次启动会显示 24 词助记词，请务必安全备份！**

#### 3. 配置 OwliaBot 连接

在 OwliaBot 的 `config.yaml` 中添加：
```yaml
wallet:
  clawlet:
    endpoint: "http://127.0.0.1:9100/rpc"
    token: "<clawlet start 输出的 token>"
```

#### 4. 验证连接

```bash
curl -X POST http://127.0.0.1:9100/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"health","params":{},"id":1}'
```

### API 方法

| 方法 | 权限 | 说明 |
|------|------|------|
| `health` | — | 健康检查 |
| `address` | — | 获取钱包地址 |
| `balance` | `read` | 查询 ETH/ERC-20 余额 |
| `transfer` | `trade` | 执行转账（受策略管控） |
| `auth.grant` | — | 授权新 token |
| `auth.revoke` | — | 撤销 token |

### 安全模型

- **Tier 1**：大额转账 → 需要用户通过 Companion App 确认
- **Tier 2**：小额自动化 → Session Key 限额内自动执行
- **Tier 3**：只读操作（余额查询等）→ 直接执行
- 所有操作记录审计日志（`~/.clawlet/audit.jsonl`），写入失败则操作不执行（fail-closed）

### 更多文档

- [使用指南](https://github.com/owliabot/clawlet/blob/main/docs/usage.md)
- [部署指南](https://github.com/owliabot/clawlet/blob/main/docs/deployment.md)
- [策略配置](https://github.com/owliabot/clawlet/blob/main/config/policy.example.yaml)

---

Add whatever helps you do your job. This is your cheat sheet.
