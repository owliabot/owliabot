# API Key Management

API Keys 提供长期有效的程序化访问令牌，适用于自动化脚本、第三方集成、CI/CD 等场景——无需走设备配对流程。

## 概览

| 认证方式 | 用途 | 获取方式 |
|----------|------|----------|
| Gateway Token | 管理操作（审批设备、管理 API Key） | 配置文件 `gateway.http.token` |
| Device Token | 已配对设备的工具/系统调用 | 设备配对流程自动颁发 |
| **API Key** | **程序化访问工具/系统/MCP** | **管理员通过 CLI 或 API 创建** |

## 快速开始

### 1. 创建 API Key

**CLI 方式：**

```bash
# 创建只读权限的 key
owliabot api-key create --name "monitor-bot" --scope tools:read

# 创建读写 + 系统调用权限的 key
owliabot api-key create --name "deploy-bot" --scope tools:write,system

# 创建全权限 key，7 天后过期
owliabot api-key create --name "temp-admin" --scope tools:sign,system,mcp --expires-in 604800

# 指定 gateway 地址和 token（也可用环境变量）
owliabot api-key create --name "my-key" --scope tools:read \
  --gateway-url http://127.0.0.1:8787 \
  --gateway-token YOUR_GATEWAY_TOKEN
```

**HTTP API 方式：**

```bash
curl -X POST http://127.0.0.1:8787/admin/api-keys \
  -H "X-Gateway-Token: YOUR_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "monitor-bot",
    "scope": { "tools": "read", "system": false, "mcp": false }
  }'
```

**响应：**

```json
{
  "ok": true,
  "data": {
    "id": "ak_a1b2c3d4",
    "key": "owk_abcdef1234567890abcdef1234567890",
    "scope": { "tools": "read", "system": false, "mcp": false },
    "expiresAt": null
  }
}
```

> ⚠️ **`key` 只在创建时返回一次，请妥善保存！** 之后只能通过 `id` 管理。

### 2. 使用 API Key

在请求头中添加 `Authorization: Bearer owk_...`：

```bash
# 调用工具
curl -X POST http://127.0.0.1:8787/command/tool \
  -H "Authorization: Bearer owk_abcdef1234567890abcdef1234567890" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_calls": [
      { "name": "read_file", "arguments": { "path": "/etc/hostname" } }
    ]
  }'

# 系统调用（需要 scope 包含 system）
curl -X POST http://127.0.0.1:8787/command/system \
  -H "Authorization: Bearer owk_abcdef1234567890abcdef1234567890" \
  -H "Content-Type: application/json" \
  -d '{ "command": "status" }'

# 事件轮询
curl http://127.0.0.1:8787/events/poll \
  -H "Authorization: Bearer owk_abcdef1234567890abcdef1234567890"
```

### 3. 管理 API Key

**列出所有 Key：**

```bash
# CLI
owliabot api-key list

# HTTP
curl http://127.0.0.1:8787/admin/api-keys \
  -H "X-Gateway-Token: YOUR_GATEWAY_TOKEN"
```

**撤销 Key：**

```bash
# CLI
owliabot api-key revoke ak_a1b2c3d4

# HTTP
curl -X DELETE http://127.0.0.1:8787/admin/api-keys/ak_a1b2c3d4 \
  -H "X-Gateway-Token: YOUR_GATEWAY_TOKEN"
```

## Scope 权限模型

API Key 使用与设备相同的 `DeviceScope` 权限模型：

| Scope 字段 | 值 | 说明 |
|------------|------|------|
| `tools` | `"read"` | 只能调用只读工具（如 `read_file`、`web_search`） |
| `tools` | `"write"` | 可调用读写工具（如 `edit_file`、`write_file`） |
| `tools` | `"sign"` | 可调用所有工具，包括签名/交易类 |
| `system` | `true/false` | 是否允许系统调用（`/command/system`） |
| `mcp` | `true/false` | 是否允许 MCP 服务访问（`/mcp`） |

**Scope 字符串格式**（CLI 用）：逗号分隔，如 `tools:write,system,mcp`

**Scope JSON 格式**（API 用）：
```json
{ "tools": "write", "system": true, "mcp": false }
```

**权限继承**：`sign` > `write` > `read`。高权限自动包含低权限的工具访问。

## Docker 环境

在 Docker 部署中使用 API Key：

### 创建 API Key

```bash
# 通过 docker exec 运行 CLI
docker exec -it owliabot owliabot api-key create \
  --name "monitor-bot" \
  --scope tools:read

# 或直接调用 HTTP API（需要将端口映射出来）
curl -X POST http://localhost:8787/admin/api-keys \
  -H "X-Gateway-Token: YOUR_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "monitor-bot", "scope": { "tools": "read", "system": false, "mcp": false } }'
```

### 管理 API Key

```bash
# 列出
docker exec -it owliabot owliabot api-key list

# 撤销
docker exec -it owliabot owliabot api-key revoke ak_xxxx
```

### Docker Compose 端口配置

确保 `docker-compose.yml` 中映射了 HTTP Gateway 端口：

```yaml
services:
  owliabot:
    image: ghcr.io/owliabot/owliabot:latest
    ports:
      - "8787:8787"   # HTTP Gateway
    environment:
      - OWLIABOT_GATEWAY_TOKEN=your-gateway-token
    volumes:
      - ./config:/app/config
      - ./workspace:/home/owliabot/.owliabot/workspace
```

### 从外部访问

Docker 容器内 CLI 会自动使用容器内的 gateway 地址。从宿主机或其他容器访问时：

```bash
# 宿主机访问
export OWLIABOT_GATEWAY_URL=http://localhost:8787
export OWLIABOT_GATEWAY_TOKEN=your-gateway-token
owliabot api-key create --name "external-bot" --scope tools:read

# 或直接 curl
curl -X POST http://localhost:8787/command/tool \
  -H "Authorization: Bearer owk_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{ "tool_calls": [{ "name": "read_file", "arguments": { "path": "/etc/hostname" } }] }'
```

### 容器间访问

同一 Docker 网络中的其他容器可通过服务名访问：

```bash
# 从同网络的其他容器
curl -X POST http://owliabot:8787/command/tool \
  -H "Authorization: Bearer owk_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{ "tool_calls": [{ "name": "web_search", "arguments": { "query": "hello" } }] }'
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OWLIABOT_GATEWAY_URL` | Gateway HTTP 地址 | `http://127.0.0.1:8787` |
| `OWLIABOT_GATEWAY_TOKEN` | Gateway 管理 Token | — |

设置后 CLI 无需每次传 `--gateway-url` 和 `--gateway-token`。

## API 参考

### POST /admin/api-keys

创建新 API Key。需要 Gateway Token 认证。

**Headers:** `X-Gateway-Token: <gateway-token>`, `Content-Type: application/json`

**Body:**
```json
{
  "name": "string (必填)",
  "scope": { "tools": "read|write|sign", "system": false, "mcp": false },
  "expiresAt": 1234567890000
}
```

- `scope` 可选，默认 `{ tools: "read", system: false, mcp: false }`
- `expiresAt` 可选，Unix 毫秒时间戳，不填则永不过期

**Response:** `{ ok: true, data: { id, key, scope, expiresAt } }`

### GET /admin/api-keys

列出所有 API Key。需要 Gateway Token 认证。

**Response:**
```json
{
  "ok": true,
  "data": {
    "keys": [
      {
        "id": "ak_xxxx",
        "name": "my-bot",
        "scope": { "tools": "read", "system": false, "mcp": false },
        "createdAt": 1234567890000,
        "expiresAt": null,
        "revokedAt": null,
        "lastUsedAt": 1234567890000
      }
    ]
  }
}
```

### DELETE /admin/api-keys/:id

撤销 API Key。需要 Gateway Token 认证。

**Response:** `{ ok: true }` 或 `404 { ok: false, error: { code: "ERR_NOT_FOUND" } }`

## 错误码

| HTTP | Code | 说明 |
|------|------|------|
| 401 | `ERR_UNAUTHORIZED` | Key 无效、已撤销或已过期 |
| 403 | `ERR_SCOPE_INSUFFICIENT` | Key 的 scope 不足以执行此操作 |
| 400 | `ERR_INVALID_REQUEST` | 请求格式错误 |
| 404 | `ERR_NOT_FOUND` | Key ID 不存在或已撤销 |

## 安全建议

1. **最小权限原则**：只授予必要的 scope，大多数场景 `tools:read` 足够
2. **设置过期时间**：临时用途的 key 建议设 `--expires-in`
3. **定期审计**：用 `owliabot api-key list` 检查不再使用的 key 并撤销
4. **保护 key**：不要将 key 写入代码仓库或日志；使用环境变量传递
5. **撤销而非删除**：撤销后 key 仍在列表中可审计，但不可再使用
