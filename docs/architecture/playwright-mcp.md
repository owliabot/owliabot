# Playwright MCP 集成规范（v0.1） 🚫

> 目标：定义 OwliaBot 的 Playwright MCP 接入方式、权限模型与安全约束（HTTP v1）。
>
> **实现状态：未开始**

## 1. 接入形态 🚫

- Playwright 以独立 MCP Server 进程运行。
- 启动后向 Gateway 注册能力（`capabilityId = mcp.playwright`）。
- 所有调用经由 `POST /command/mcp` 进入 Tool Executor。

## 2. 能力注册 🚫

```
POST /capabilities/register
{
  capabilityId: "mcp.playwright",
  scope: "browser",
  level: "read|write",
  rateLimit,
  version,
  owner,
  expiresAt,
  status
}
```

## 3. 动作与权限映射 🚫

### 3.1 read 动作
- `goto`
- `wait_for`
- `screenshot`
- `get_content`
- `query`

### 3.2 write 动作
- `click`
- `type`
- `select`
- `download`
- `upload`
- `close`

### 3.3 禁用动作（默认）
- `evaluate`
- `exposeBinding`
- `route`
- `setRequestInterception`

## 4. 请求模型（建议） 🚫

```
POST /command/mcp
{
  requestId,
  idempotencyKey,
  payload: {
    capabilityId: "mcp.playwright",
    action: "click",
    args: { selector: "#submit" },
    sessionId,
    context: { url, userAgent, locale }
  },
  security: { level: "write" }
}
```

## 5. 域名与下载策略 🚫

- v1 默认允许任意域名（后续可加 allowlist/denylist）。
- 下载目录按 session 受控：`workspace/downloads/<sessionId>`。
- 上传仅允许读取 `workspace/uploads/<sessionId>`（可选）。

生产加固建议：
- 启用沙箱/容器化运行。
- 通过配置将默认策略切换为域名 allowlist。

## 6. 审计字段（建议） 🚫

- action / selector / url
- security.level
- durationMs
- downloadedFiles[]（name/size/hash）
- error.code / error.message

---

> 本文档为 Playwright MCP 集成规范基线，可在 v1 迭代中调整字段与动作集合。

---

## 实现状态图例

- ✅ 已实现且测试通过
- ⏳ 部分实现或进行中
- 🚫 未开始或设计已废弃

_最后更新: 2026-02-04_
