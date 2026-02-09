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
| `/command/tool` | POST | 工具调用 | 设备 Token |
| `/command/system` | POST | 系统能力调用 | 设备 Token |
| `/events/poll` | GET | 事件轮询 | 设备 Token |
| `/mcp` | POST | MCP JSON-RPC | 设备 Token |
| `/admin/devices` | GET | 设备管理 | Gateway Token |
| `/admin/pair/approve` | POST | 审批配对 | Gateway Token |
| `/admin/pair/reject` | POST | 拒绝配对 | Gateway Token |

#### 2.3 认证统一

两层认证保持不变：

| 层级 | Token 类型 | 来源 | 权限 |
|------|-----------|------|------|
| Admin | Gateway Token | 配置文件 `gateway.http.token` | 全部管理操作 |
| Device | Device Token | Pairing 流程颁发 | 工具调用 + 事件轮询 |

新增：**Scope-based 权限**（与 Tier 系统对齐）

```typescript
interface DeviceScope {
  tools: "read" | "write" | "sign";  // 工具权限
  system: boolean;                    // 系统能力
  mcp: boolean;                       // MCP 访问
}
```

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
package.json                       # 删除 "gateway" script
```

## 测试计划

1. **现有 HTTP 测试**（`src/gateway/http/__tests__/`）全部保留并适配
2. 新增：共享 tool registry 场景测试（HTTP 调用能访问真实 session）
3. 新增：MCP 路由测试
4. 验证：删除独立入口后 `npm run build` + `npm test` 全绿

## 时间估算

| 阶段 | 工作量 | 产出 |
|------|--------|------|
| Phase 1 | 0.5d | 合并资源、删除重复代码 |
| Phase 2 | 1d | HTTP Channel Adapter + 路由统一 |
| Phase 3 | TBD | WebSocket / 多实例 / API Key |

## 验收标准

- [ ] `http-entry.ts` 和 `http/tooling.ts` 已删除
- [ ] HTTP tool 调用使用主 Gateway 的 tool registry（有真实 session）
- [ ] 所有现有测试通过
- [ ] MCP 可通过 HTTP 路由访问
- [ ] `npm run build` + `npm test` 全绿
