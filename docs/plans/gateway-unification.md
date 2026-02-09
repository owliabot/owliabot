# RFC: Gateway 统一 — 合并 HTTP Gateway 到主 Gateway

## 背景

当前 owliabot 有两套 Gateway 逻辑：

| 模块 | 路径 | 职责 |
|------|------|------|
| **主 Gateway** | `src/gateway/server.ts` | Channel 注册、session 管理、agent loop、tool 执行、cron、skills、notifications |
| **HTTP Gateway** | `src/gateway/http/server.ts` | 设备 pairing、HTTP tool call、system command、events poll |
| **HTTP 独立入口** | `src/gateway/http-entry.ts` | 可独立启动 HTTP Gateway（不跑 channel） |

问题：
1. **Tool Registry 重复**：HTTP Gateway 在 `http/tooling.ts` 中自建了一套 noop session store + noop transcript store + 独立 tool registry，与主 Gateway 的完全割裂
2. **能力不对等**：HTTP 端的 tool 调用无法访问真实 session/transcript，MCP、cron、skills 也未接入
3. **独立入口无实际场景**：`http-entry.ts` 单独跑 HTTP 没有意义（没有 channel = 没有用户交互）
4. **消息总线目标未达成**：Gateway 应该是 channel、tool、MCP、system call 的统一消息总线 + 基础权限校验

> **注意**：Phase 1 从已有 `gateway/http` 整合基线出发（`gateway.http.enabled` 已合并），是延续而非平行迁移。

> **Phase 1 状态 (2026-02-09)**：共享资源注入已完成（toolRegistry + sessionStore + transcripts）。独立入口 `http-entry.ts` 和 `npm run gateway` 已废弃，仅保留历史文档引用。
>
> **Phase 2 状态 (2026-02-09)**：HTTP API 已转换为 Channel Adapter，与 Discord/Telegram 并列。主要变更：
> - ✅ 创建 HTTP ChannelPlugin (`src/gateway/http/channel.ts`)
> - ✅ 实现 DeviceScope 模型 (`src/gateway/http/scope.ts`)
> - ✅ 重构 HTTP server routes（新增 `/admin/*`、`/pair/*`、`/mcp`）
> - ✅ 删除 `src/gateway/http/tooling.ts`（Phase 1 兼容层）
> - ✅ 更新 store schema（scope + acked_at + target_device_id）
> - ✅ 添加 ACK 机制到 `/events/poll`
> - ✅ 完整测试覆盖（scope、ACK、admin routes、channel plugin）

## 目标

将 Gateway 统一为**单一消息总线**，HTTP 层作为其中一个接入方式（与 Discord/Telegram channel 并列）：

```
┌─────────────────────────────────────────────┐
│              Gateway (server.ts)             │
│                                             │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Discord │ │ Telegram │ │  HTTP API    │ │
│  │ Channel │ │ Channel  │ │ (内置路由)    │ │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘ │
│       │           │              │          │
│       ▼           ▼              ▼          │
│  ┌──────────────────────────────────────┐   │
│  │         Shared Infrastructure        │   │
│  │  Session Store · Tool Registry ·     │   │
│  │  MCP Manager · Cron · Skills ·       │   │
│  │  Notifications · Audit Logger        │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## 方案

### Phase 1: 合并（破坏性最小）

> 延续已有 `gateway.http.enabled` 整合方向，核心改动是资源注入 + 去重。

#### 1.1 HTTP Server 共享主 Gateway 资源

**当前**：`startGatewayHttp()` 只接收 `config` + `workspacePath` + `system`
**改为**：注入主 Gateway 的共享资源

```typescript
// src/gateway/server.ts
if (config.gateway?.http?.enabled) {
  const httpGateway = await startGatewayHttp({
    config: config.gateway.http,
    // 新增：共享资源注入
    toolRegistry: tools,          // 主 Gateway 的 tool registry
    sessionStore,                 // 真实 session store
    transcripts,                  // 真实 transcript store
    mcpManager,                   // MCP manager（如果有）
    channels,                     // channel registry（用于 notifications）
    system: config.system,
  });
}
```

#### 1.2 删除 HTTP 独立 tooling

- 删除 `src/gateway/http/tooling.ts`（noop session store、独立 tool registry）
- HTTP handler 直接用注入的 `toolRegistry`
- `POST /command/tool` → `executeToolCalls(toolRegistry, ...)`

#### 1.3 删除独立入口

- 删除 `src/gateway/http-entry.ts`
- 删除 `package.json` 中的 `"gateway": "tsx src/gateway-http.ts"` script
- 也删除 `src/gateway-http.ts`（如果还存在）

#### 1.4 迁移说明（Breaking Change）

**删除的启动方式：**
```bash
# ❌ 不再支持
npm run gateway
npx tsx src/gateway-http.ts
```

**新的唯一启动路径：**
```bash
# ✅ 通过主 Gateway 启动，HTTP 自动随主进程启动
npm run dev -- start -c config.yaml
# config.yaml 中 gateway.http.enabled: true 即可
```

**需要更新的文档：**
- `README.md` / `README.zh-CN.md` 中的 Gateway HTTP 章节
- `docs/setup-verify.md` 中的启动方式
- `config.example.yaml` 中的注释

### Phase 2: HTTP 作为 Channel Adapter

#### 2.1 HTTP Channel 接口

将 HTTP API 的消息处理统一到 channel 接口：

```typescript
// src/gateway/http/channel.ts
import type { ChannelPlugin, MsgContext } from "../../channels/interface.js";

export function createHttpChannel(opts: {
  store: Store;           // pairing/device store
  config: GatewayHttpConfig;
}): ChannelPlugin {
  return {
    id: "http",
    
    // HTTP 不需要 "start" 连接（由 HTTP server 驱动）
    async start() {},
    async stop() {},
    
    // 发送消息到已配对设备（通过 events/poll）
    async send(target, content) {
      store.pushEvent({
        type: "message",
        source: "gateway",
        message: content,
        deviceId: target,
      });
    },
  };
}
```

#### 2.2 路由规划

统一到主 Gateway 的 HTTP 端口：

| 路由 | 方法 | 功能 | 认证 |
|------|------|------|------|
| `/health` | GET | 健康检查 | 无 |
| `/status` | GET | 系统状态 | Gateway Token |
| `/pair/request` | POST | 设备配对请求 | 无（需审批） |
| `/pair/status` | GET | 配对状态查询 | 设备 Token |
| `/command/tool` | POST | 工具调用 | 设备 Token + Scope |
| `/command/system` | POST | 系统能力调用 | 设备 Token + Scope |
| `/events/poll` | GET | 事件轮询 | 设备 Token |
| `/mcp` | POST | MCP JSON-RPC | 设备 Token + Scope |
| `/admin/devices` | GET | 设备管理 | Gateway Token |
| `/admin/pair/approve` | POST | 审批配对 | Gateway Token |
| `/admin/pair/reject` | POST | 拒绝配对 | Gateway Token |

#### 2.3 AuthZ 模型：Scope 与 Tier 的关系

##### Scope 定义与存储

Scope 在 **pairing 审批时颁发**，存储在 device store（SQLite）中：

```typescript
interface DeviceScope {
  tools: "read" | "write" | "sign";  // 工具权限级别
  system: boolean;                    // 系统能力（exec/web.fetch/web.search）
  mcp: boolean;                       // MCP 服务访问
}

// 存储在 device record 中
interface DeviceRecord {
  deviceId: string;
  tokenHash: string | null;
  scope: DeviceScope;              // 新增
  revokedAt: number | null;
  pairedAt: number | null;
  lastSeenAt: number | null;
}
```

**颁发方式**：管理员审批配对时指定 scope：
```bash
# CLI
owliabot pair approve <deviceId> --scope tools:read,system

# HTTP API
POST /admin/pair/approve
{ "deviceId": "xxx", "scope": { "tools": "read", "system": true, "mcp": false } }
```

默认 scope（未显式指定时）：`{ tools: "read", system: false, mcp: false }`（最小权限）

##### Scope ↔ Tier 优先级规则

```
请求到达 → Scope 检查（粗粒度） → Tier Policy 检查（细粒度）
```

**Scope 是门禁，Tier 是审批流程：**

1. **Scope 先行（硬拒绝）**：如果设备 scope 不允许该操作类型，直接 403，不进入 Tier 流程
   - `tools: "read"` → 只能调用 Tier none 的只读工具
   - `tools: "write"` → 可调用 Tier none + Tier 3 工具（自动执行范围）
   - `tools: "sign"` → 可调用所有 Tier 工具（但 Tier 1/2 仍需确认）
2. **Tier 后行（流程控制）**：通过 scope 后，按 `policy.yml` 的 Tier 规则走确认/审批流程

##### 示例

| 操作 | 需要 Scope | Tier | 结果 |
|------|-----------|------|------|
| `read_file` | `tools: "read"` | none | ✅ 直接执行 |
| `edit_file` | `tools: "write"` | 3 | ✅ session key 自动执行 |
| `wallet_transfer $10` | `tools: "sign"` | 2 | ✅ 需 inline 确认 |
| `wallet_transfer $10` | `tools: "write"` | — | ❌ scope 不足，403 |
| `exec("ls")` | `system: true` | none | ✅ 直接执行 |
| `exec("ls")` | `system: false` | — | ❌ scope 不足，403 |

##### Scope 撤销与轮换

- **撤销**：`POST /admin/devices/:id/revoke` 或 `owliabot pair revoke <deviceId>`
- **Scope 变更**：`POST /admin/devices/:id/scope` 热更新，不需要重新配对
- **Token 轮换**：`POST /admin/devices/:id/rotate-token` 生成新 token，旧 token 立即失效
- **自动撤销**：与 Tier audit 系统联动——连续 3 次 deny → 自动降级 scope 到 read-only

##### 敏感 system 能力的工具级 allow/deny

`system` scope 为 true 时，仍可通过配置限制具体能力：

```yaml
gateway:
  http:
    systemCapabilities:
      exec:
        enabled: true
        commandAllowList: ["ls", "cat", "git status"]  # 白名单
      webFetch:
        enabled: true
        domainDenyList: ["*.internal.corp"]             # 黑名单
      webSearch:
        enabled: true
```

#### 2.4 事件投递语义（Delivery Semantics）

HTTP Channel 通过 `/events/poll` 投递消息到设备，需要明确的可靠性保证：

##### 投递保证：At-Least-Once

```
设备 → GET /events/poll?ack=<lastEventId>
       ← [event1, event2, event3]
设备 → GET /events/poll?ack=event3
       ← [event4, ...]  (event1-3 不再返回)
```

- **ACK 机制**：设备在下一次 poll 时传入 `ack=<lastEventId>`，Gateway 标记该 ID 及之前的事件为已消费
- **未 ACK 的事件**：保持可用，下次 poll 重新返回（at-least-once）
- **客户端去重**：事件有唯一 `id`（ULID），设备端负责幂等处理

##### 排序保证

- **单设备内严格有序**：事件按插入顺序返回（SQLite autoincrement ID）
- **跨设备无保证**：不同设备的事件流独立

##### 保留与积压限制

| 参数 | 默认值 | 配置键 |
|------|--------|--------|
| 事件 TTL | 24h | `gateway.http.eventTtlMs` |
| 最大积压 | 1000 条/设备 | `gateway.http.maxEventsPerDevice` |
| Poll 批量上限 | 100 条/次 | `gateway.http.pollBatchSize` |

- **超过 TTL**：自动清理（已有 `store.cleanup()`）
- **超过积压上限**：最旧的未 ACK 事件被丢弃，并在下次 poll 的响应头 `X-Events-Dropped: N` 中告知设备

##### 幂等性

- **Tool call**：已有 idempotency key 机制（`X-Idempotency-Key` header → SQLite 缓存响应）
- **Event push**：Gateway 内部 `pushEvent()` 使用 ULID 保证唯一性
- **Pair request**：相同 `deviceId` 重复请求返回现有 pending 状态（不重复创建）

### Phase 3: 未来扩展

- **WebSocket 支持**：替代 events/poll，实时推送
- **多 Gateway 实例**：通过 Redis/SQLite WAL 共享 session store
- **API Key 管理**：CLI `owliabot api-key create/revoke`

## 需要删除的文件

```
src/gateway/http-entry.ts          # 独立入口
src/gateway/http/tooling.ts        # 重复 tool registry
src/gateway-http.ts                # 旧独立入口（如存在）
```

## 需要修改的文件

```
src/gateway/server.ts              # 注入共享资源到 HTTP
src/gateway/http/server.ts         # 接收共享资源，删除自建 tool registry
src/gateway/http/store.ts          # 新增 scope 字段到 DeviceRecord
package.json                       # 删除 "gateway" script
README.md / README.zh-CN.md        # 更新启动方式
docs/setup-verify.md               # 更新启动方式
config.example.yaml                # 更新注释
```

## 测试计划

### 正向路径（Positive）
1. **共享 Tool Registry**：HTTP tool call 写入真实 transcript → 验证 `transcripts.getHistory()` 能查到
2. **Session 一致性**：HTTP 请求的 sessionKey = `http:<deviceId>`，与 channel + permissions 一致
3. **MCP 路由共享**：HTTP `/mcp` 调用使用主 Gateway 的 `MCPManager`，返回正确的 tool list

### 负向路径（Negative）
4. **401 未认证**：无 token → 401（tool call / system / events / admin）
5. **403 scope 不足**：`tools: "read"` 的设备调用 `edit_file` → 403 + `{ error: { code: "ERR_SCOPE_INSUFFICIENT" } }`
6. **403 IP 拦截**：非白名单 IP → 403
7. **429 限流**：超过 rate limit → 429 + `Retry-After` header

### 回归测试
8. **现有 HTTP 测试**（`src/gateway/http/__tests__/`）全部保留并适配新的资源注入签名
9. **删除独立入口后** `npm run build` + `npm test` 全绿
10. **E2E**：完整 pairing → tool call → events poll 流程

## 时间估算

| 阶段 | 工作量 | 产出 |
|------|--------|------|
| Phase 1 | 0.5d | 合并资源、删除重复代码、迁移说明 |
| Phase 2 | 1.5d | HTTP Channel Adapter + 路由统一 + AuthZ + 投递语义 |
| Phase 3 | TBD | WebSocket / 多实例 / API Key |

## 验收标准

### Phase 1 ✅
- [x] `http-entry.ts` 和 `http/tooling.ts` 已删除
- [x] HTTP tool 调用使用主 Gateway 的 tool registry（有真实 session + transcript）

### Phase 2 ✅ (2026-02-09)
- [x] HTTP ChannelPlugin 实现 (`src/gateway/http/channel.ts`)
- [x] DeviceScope 模型实现 (`src/gateway/http/scope.ts`)
- [x] Scope 权限在 pairing 时颁发，请求时校验，支持热更新和撤销
- [x] 事件投递为 at-least-once，有 ACK 机制
- [x] 所有现有测试通过 + 新增正向/负向测试覆盖
- [x] MCP 路由已添加（stub，返回 501 Not Implemented）
- [x] Admin routes 完整实现（devices、approve、reject、revoke、scope、rotate-token）

### Phase 3 (未来)
- [ ] MCP 完整实现
- [ ] WebSocket 支持（替代 events/poll）
- [ ] 多 Gateway 实例支持
- [ ] API Key 管理 CLI
