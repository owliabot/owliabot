# OwliaBot Gateway 设计文档（v0.2）

> 说明：当前阶段采用 HTTP-only Gateway（v1），WebSocket 作为 v2 预留扩展。

## 1. 目标与边界

### 1.1 目标
- 统一承载接入、鉴权、审计、幂等与能力路由，形成统一入口层。
- 为 MCP/Playwright 与系统能力层提供一致的权限语义与审计路径。
- 保持 OwliaBot 的“本地优先、轻依赖、可审计”原则。

### 1.2 边界
- 不引入多渠道泛接入（仍以 Telegram/Discord 为主）。
- Gateway 不承担 LLM/Tool 的业务逻辑执行，仅负责接入与治理。
- Gateway 不绕过 Tool Executor 直接调用能力。

## 2. 架构定位

### 2.1 分层角色
- **Gateway**：连接准入、鉴权、审计、状态快照、能力路由。
- **Agent Runtime（执行平面）**：Prompt/LLM/Tools/Skills 运行逻辑。
- **Tool Executor（安全平面）**：read/write/sign 权限判断与确认流。

### 2.2 统一入口
所有 tool/system/mcp 调用必须经由 Gateway 进入 Tool Executor，禁止旁路。

## 3. 定位与入口策略

### 3.1 Gateway 定位
- Gateway 是统一控制与调度入口，不是“单体业务入口”。
- 所有跨模块请求必须进入 Gateway 协议面，避免旁路。

### 3.2 入口协议（v1）
- **对外**：HTTP（健康检查、状态、命令、事件轮询）。
- **对内**：内部总线/路由（消息分发与能力调用）。

### 3.3 Gateway 职责
1. **统一入口**：聚合来自 CLI / Channel / 定时任务 / 系统能力层的请求。
2. **路由与治理**：基于策略转发到 Agent Runtime、Tool Executor、MCP、System Capability。
3. **审计与追踪**：记录 requestId、sessionKey、actor、traceId。
4. **幂等与重试**：处理幂等键与重试策略。
5. **安全校验**：统一鉴权、签名验证、权限校验、速率限制。

## 4. 协议形态

### 4.1 v1（HTTP-only）
- `GET /health`：健康检查
- `GET /status`：运行态快照
- `POST /command/agent`：触发 Agent 请求
- `POST /command/tool`：调用 Tool
- `POST /command/system`：系统能力调用（exec/fetch/search）
- `POST /command/mcp`：MCP 能力调用
- `GET /events/poll`：事件轮询（可选）

所有有副作用请求必须携带 `Idempotency-Key`，Gateway 保持短期去重缓存（5~10 分钟）。

### 4.2 v2（WebSocket 预留）
- 首帧 `connect`
- `req/res/event` 三态结构
- 保留字段：`deviceId`、`clientType`、`capabilities`、`auth`、`challenge`

## 5. 身份与配对模型

### 5.1 设备身份
- 所有请求必须带 `X-Device-Id`。
- 首次设备进入“待配对”状态。

### 5.2 设备令牌
- Gateway 对已配对设备发放 `X-Device-Token`。
- 后续请求必须携带 `X-Device-Token`。

### 5.3 本地信任策略
- 本机/同主机来源可自动批准（可配置开关）。
- 非本地来源需显式批准（CLI/控制接口）。

### 5.4 全局令牌（可选）
- 启用 `X-Gateway-Token` 时，所有请求必须同时满足 GatewayToken + DeviceToken。

### 5.5 配对与撤销（管理入口）
- 提供配对审批与撤销入口（如 `/pairing/pending`、`/pairing/approve`、`/pairing/revoke`）。
- 撤销后相关 `X-Device-Token` 立即失效，并要求重新配对。

## 6. 事件与运行态视图

### 6.1 事件类型（v1）
- `health / heartbeat / cron`
- `agent.output / tool.progress / tool.result`
- `mcp.event / system.alert / session.update`

### 6.2 获取方式
- `GET /status`：完整快照
- `GET /events/poll?since=<cursor>`：增量事件

### 6.3 快照内容
- Gateway 版本与运行健康
- 活跃设备列表
- 运行中任务（agent/tool/mcp）
- 最近心跳与 cron 触发记录

### 6.4 游标语义（v1）
- `cursor` 单调递增、短期有效（建议 TTL 24h）。
- 过期或缺失时客户端回退到 `GET /status`。

## 7. 工具执行链与安全边界

### 7.1 责任边界
- Gateway：准入校验、审计标记、路由
- Tool Executor：权限裁决与确认流程（read/write/sign）

### 7.2 审计链路
- Gateway 记录 `deviceId / capabilityId / idempotencyKey / requestHash`
- Tool Executor 记录执行结果、风险级别、确认状态

### 7.3 错误码规范
- 统一错误码枚举（如 `ERR_AUTH_REQUIRED`、`ERR_PERMISSION_DENIED`、`ERR_IDEMPOTENCY_CONFLICT`、`ERR_RATE_LIMITED`）。

## 8. MCP / 系统能力层

### 8.1 MCP 接入
- MCP 服务作为“受控能力服务”注册到 Gateway。
- 注册字段：`capabilityId / scope / level / rateLimit`。

### 8.2 Playwright MCP 约束（v1）
- 作为独立 MCP Server 进程注册（`capabilityId = mcp.playwright`）。
- 调用路径：`Client → Gateway /command/mcp → Tool Executor → MCP Adapter → Playwright MCP`。
- 动作级权限：read（`goto`/`wait_for`/`screenshot`/`get_content`/`query`），write（`click`/`type`/`select`/`download`/`upload`/`close`）。
- 安全策略：不强制 sandbox；动作白名单；默认允许任意域名（后续可加 allow/deny）；下载/上传目录按 `sessionId` 受控。
- 生产加固建议：启用沙箱/容器化运行，并通过配置将默认策略切换为域名 allowlist。

### 8.3 系统能力层
- `exec / web fetch / web search` 统一为 SystemCapability。
- 统一链路：`Client → Gateway → Tool Executor → Capability`。
- 动作级权限：`exec = write`，`web.fetch = read`，`web.search = read`。
- 安全策略：命令白名单 + 工作目录限制 + 环境变量隔离；域名策略 + 超时 + 最大响应；允许 POST 但必须做敏感信息审查。
  - 敏感信息审查建议：自动扫描常见机密模式；命中高置信规则默认阻断或要求显式确认。

## 9. 兼容策略

### 9.1 简化模式
- 允许“HTTP-only + 内部调用”作为早期实现。

### 9.2 演进路径
- 当需要实时事件或流式输出时，引入 WS v2。

---

> 本文档为 Gateway 设计基线，可与后续实现/协议文档同步迭代。
