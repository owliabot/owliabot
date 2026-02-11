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

- **已连接时**：直接使用 `wallet_balance` / `wallet_transfer` 等工具
- **未连接时**：引导用户查阅 Clawlet 文档完成安装和配置

### 文档参考

当用户想使用钱包功能但 Clawlet 尚未安装/配置时，引导用户查阅以下文档：

- [README — 快速开始 & 安装](https://github.com/owliabot/clawlet#readme)
- [使用指南 — 初始化、启动、API 接口](https://github.com/owliabot/clawlet/blob/main/docs/usage.md)
- [部署指南 — 生产环境配置](https://github.com/owliabot/clawlet/blob/main/docs/deployment.md)
- [策略配置 — 限额与权限规则](https://github.com/owliabot/clawlet/blob/main/config/policy.example.yaml)

---

Add whatever helps you do your job. This is your cheat sheet.
