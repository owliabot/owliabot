# OwliaBot Gateway 功能文档（v0.2）

> 面向产品与运维视角的功能说明，基于 HTTP-only v1 Gateway 设计。

## 1. 功能概览 ✅

### 1.1 Gateway 提供的核心能力
- **统一接入**：所有 tool/system/mcp 调用由 Gateway 统一入口处理。
- **统一鉴权**：设备身份 + 设备令牌 + 可选全局令牌。
- **统一审计**：对能力调用进行元信息记录与追踪。
- **幂等与治理**：对有副作用请求进行幂等去重与速率限制。
- **运行态视图**：健康检查、状态快照、事件轮询。

### 1.2 不做的事情
- 不执行 LLM 与 Tool 业务逻辑。
- 不引入多渠道聚合（保持 Telegram/Discord）。
- 不允许绕过 Gateway 直连能力后端。

## 2. 用户/运维交互流程 ✅

### 2.1 设备接入 ✅
1. 客户端首次请求携带 `X-Device-Id`。
2. Gateway 将设备标记为"待配对"。
3. 管理员批准后发放 `X-Device-Token`。
4. 后续请求均携带 `X-Device-Token`。

可选管理入口：
- `GET /pairing/pending`：查看待配对设备 ✅
- `POST /pairing/approve`：批准并签发设备令牌 ✅
- `POST /pairing/revoke`：撤销设备与令牌 ✅

### 2.2 请求执行 ✅
1. 客户端请求 `/command/*`。
2. Gateway 校验身份与幂等键。
3. Gateway 转发至 Tool Executor。
4. Tool Executor 进行 read/write/sign 安全判断与确认。

### 2.3 状态查询 ⏳
- `GET /health`：服务健康 ✅
- `GET /status`：运行态快照 ⏳
- `GET /events/poll`：增量事件 ✅

## 3. 关键功能清单 ⏳

### 3.1 Gateway API（v1）
- `GET /health` ✅
- `GET /status` ⏳
- `POST /command/agent` 🚫
- `POST /command/tool` ✅
- `POST /command/system` 🚫
- `POST /command/mcp` 🚫
- `GET /events/poll?since=<cursor>` ✅

### 3.2 幂等性保证 ✅
- 所有有副作用请求必须携带 `Idempotency-Key`。
- Gateway 维护 5~10 分钟去重缓存。
- 重复请求返回相同结果或 `ERR_IDEMPOTENCY_CONFLICT`。

### 3.3 安全模型 ✅
- `X-Device-Id` + `X-Device-Token` 设备身份
- 可选 `X-Gateway-Token`
- Tool Executor 负责 read/write/sign 审核
- Gateway 只做入口鉴权与审计标记

## 4. 运行态视图 ⏳

### 4.1 快照内容
- Gateway 版本与运行健康
- 活跃设备列表
- 运行中任务（agent/tool/mcp）
- 最近心跳与 cron 触发

### 4.2 事件类型
- `health / heartbeat / cron`
- `agent.output / tool.progress / tool.result`
- `mcp.event / system.alert / session.update`

### 4.3 事件游标
- `cursor` 单调递增，过期需回退到 `GET /status`。

## 5. 演进方向 🚫

### 5.1 WebSocket v2 🚫
- 引入 `connect + req/res/event` 协议
- 事件流与流式响应替代轮询

### 5.2 更细粒度授权 🚫
- 支持能力级白名单、限额与 TTL

---

> 本文档用于产品/运维沟通，与技术协议文档配套使用。

---

## 实现状态图例

- ✅ 已实现且测试通过
- ⏳ 部分实现或进行中
- 🚫 未开始或设计已废弃

_最后更新: 2026-02-04_
