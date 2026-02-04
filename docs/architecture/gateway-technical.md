# OwliaBot Gateway 技术文档（v0.2）

> 面向工程实现与接口对接，基于 HTTP-only v1 Gateway 设计。

## 1. 认证与请求头 ✅

### 1.1 必需请求头
- `X-Device-Id`: 设备唯一标识
- `X-Device-Token`: 设备令牌（首次配对后发放）

### 1.2 可选请求头
- `X-Gateway-Token`: 全局入口令牌
- `Idempotency-Key`: 幂等键（有副作用请求必填）
- `X-Request-Id`: 外部调用方提供的请求 ID（可选）

## 2. 基础接口 ⏳

### 2.1 健康检查 ✅
```
GET /health
```
返回：`{ ok: true, version, uptime }`

### 2.2 运行态快照 ⏳
```
GET /status
```
返回：
```
{
  version,
  health,
  devices: [],
  running: { agent: [], tool: [], mcp: [] },
  heartbeat: { lastAt },
  cron: { lastAt }
}
```

### 2.3 事件轮询 ✅
```
GET /events/poll?since=<cursor>
```
返回：
```
{
  cursor,
  events: [{ id, type, time, status, source, message, durationMs, metadata }]
}
```

事件类型：
`health | heartbeat | cron | agent.output | tool.progress | tool.result | mcp.event | system.alert | session.update`

游标语义：
- `cursor` 单调递增、短期有效（建议 TTL 24h）。
- 过期或缺失时客户端回退到 `GET /status`。

### 2.4 配对管理 ✅
```
GET /pairing/pending
POST /pairing/approve
POST /pairing/revoke
```
`/pairing/approve` 返回 `X-Device-Token`（或在响应体中返回）。

## 3. 命令接口（统一模型） ⏳

所有命令使用统一模型：
```
POST /command/<type>
```

统一请求体（建议）：
```
{
  requestId,
  actor: { id, role },
  sessionKey,
  route,
  idempotencyKey,
  payload,
  security: {
    level: "read" | "write" | "sign",
    scopes: []
  },
  trace: { traceId, spanId }
}
```

统一响应体（建议）：
```
{
  ok: false,
  data,
  traceId,
  error: { code, message }
}
```

错误响应建议：
```
{
  ok: false,
  data: null,
  traceId,
  error: { code, message }
}
```

错误码（建议）：
- `ERR_AUTH_REQUIRED`
- `ERR_INVALID_TOKEN`
- `ERR_PERMISSION_DENIED`
- `ERR_IDEMPOTENCY_CONFLICT`
- `ERR_RATE_LIMITED`
- `ERR_INVALID_REQUEST`

### 3.1 Agent 🚫
```
POST /command/agent
```

### 3.2 Tool ✅
```
POST /command/tool
```

### 3.3 System 🚫
```
POST /command/system
```

System 请求示例（建议）：
```
{
  requestId,
  idempotencyKey,
  payload: {
    action: "exec",
    args: { command: "ls", params: ["-la"] },
    sessionId,
    cwd,
    env: { PATH: "..." }
  },
  security: { level: "write" }
}
```

必须使用结构化参数（`command` + `params`）并在执行前逐项校验，禁止字符串拼接执行，以降低注入风险。

```
{
  requestId,
  idempotencyKey,
  payload: {
    action: "web.fetch",
    args: { url: "https://example.com", method: "GET" },
    sessionId
  },
  security: { level: "read" }
}
```

动作级权限：
- `exec = write`
- `web.fetch = read`
- `web.search = read`

### 3.4 MCP 🚫
```
POST /command/mcp
```

Playwright MCP 请求示例（建议）：
```
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

## 4. 能力注册（MCP / System） 🚫

### 4.1 MCP 注册（内部调用） 🚫
```
POST /capabilities/register
```
请求体：
```
{
  capabilityId,
  scope,
  level,          // read | write | sign
  rateLimit,
  version,
  owner,
  expiresAt,
  status          // healthy | degraded | offline
}
```

Playwright capability 建议值：
- `capabilityId`: `mcp.playwright`
- `scope`: `browser`

### 4.2 System Capability 🚫
- `exec`
- `web.fetch`
- `web.search`

所有 System 能力通过 `/command/system` 调用，并受 Tool Executor 权限链路控制。

## 5. 幂等性与审计 ✅

### 5.1 幂等性 ✅
- Gateway 对 `Idempotency-Key` 进行去重缓存（TTL 5~10 分钟）。
- 若命中幂等缓存，返回原始响应；冲突则返回 `ERR_IDEMPOTENCY_CONFLICT`。

### 5.2 审计字段 ✅
- Gateway 记录：`deviceId / capabilityId / idempotencyKey / requestHash`
- Tool Executor 记录：`riskLevel / confirmation / result`

### 5.3 速率限制 ✅
- 通过 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `Retry-After` 返回限额信息。

## 6. v2 预留（WebSocket） 🚫

- `connect` 首帧
- `req/res/event` 消息结构
- 字段：`deviceId / clientType / capabilities / auth / challenge`

---

> 本文档用于实现与对接，如需改动字段或路径可在 v1 迭代中调整。

---

## 实现状态图例

- ✅ 已实现且测试通过
- ⏳ 部分实现或进行中
- 🚫 未开始或设计已废弃

_最后更新: 2026-02-04_
