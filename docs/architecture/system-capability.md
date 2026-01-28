# System Capability 集成规范（v0.1）

> 目标：定义 exec / web.fetch / web.search 的统一能力模型与安全约束（HTTP v1）。

## 1. 能力形态

- 统一为 SystemCapability。
- 通过 `POST /command/system` 调用。
- Tool Executor 负责 read/write 权限判断与确认。

## 2. 动作与权限映射

- `exec` → `write`
- `web.fetch` → `read`
- `web.search` → `read`

## 3. 安全策略

### 3.1 exec
- 命令白名单（只允许预定义指令）。
- 工作目录限制（仅允许在 workspace 目录下执行）。
- 环境变量隔离（白名单 env + 禁止继承宿主敏感变量）。

### 3.2 web.fetch / web.search
- 域名策略（allowlist/denylist 可配置）。
- 超时与最大响应体限制。
- 允许 POST，但需执行敏感信息审查。
  - 自动扫描常见机密模式（API Key、Token、私钥、助记词等）。
  - 命中高置信规则时默认阻断；可配置为“需要显式确认后放行”。

## 4. 请求模型（建议）

```
POST /command/system
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
POST /command/system
{
  requestId,
  idempotencyKey,
  payload: {
    action: "web.fetch",
    args: { url: "https://example.com", method: "POST", body: "..." },
    sessionId
  },
  security: { level: "read" }
}
```

## 5. 审计字段（建议）

- action / args
- security.level
- durationMs
- result.summary
- error.code / error.message

---

> 本文档为 System Capability 集成规范基线，可在 v1 迭代中调整字段与策略。
