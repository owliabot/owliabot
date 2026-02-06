# Skills System Architecture

> OwliaBot 的可扩展功能系统设计

---

## 1. 概述 ✅

### 1.1 设计目标

- **可扩展**：通过添加 Skill 文件扩展功能，无需修改核心代码
- **安全隔离**：支持 Docker 容器隔离（可选），Skill 无法访问私钥和核心数据
- **简单开发**：使用 JavaScript/TypeScript，复用 npm 生态
- **渐进信任**：从本地 Skill → 仓库安装 → 代码签名，逐步增强安全

### 1.2 核心决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 执行方式 | JS Module (dynamic import) | 实现简单、性能好、生态成熟 |
| 隔离方式 | **可选** Docker 容器 | MVP 单进程，按需加容器隔离 |
| 通信方式 | Context 注入 | MVP 原生能力，容器化后 RPC 代理 |
| 认证方式 | 分阶段：本地 → 仓库信任 → 代码签名 | MVP 简单，后期可增强 |

### 1.3 设计原则

**渐进式复杂度**：MVP 尽可能简单，复杂功能按需添加。

- MVP：单进程，Skill 直接使用原生能力（fetch、fs 等）
- 可选增强：Docker 容器隔离，能力通过 RPC 代理

**接口稳定**：Skill 始终通过 `context` 获取能力，底层实现可替换。

```javascript
// Skill 代码（不变）
const res = await context.fetch(url);

// MVP: context.fetch = globalThis.fetch
// 容器化: context.fetch = rpcProxyFetch
```

---

## 2. 架构设计 ✅

### 2.1 MVP 架构（单进程） ✅

```
┌─────────────────────────────────────────────────────────────────┐
│                       OwliaBot Process                          │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐│
│  │ Gateway       │  │ Channels      │  │ Skill Loader          ││
│  │               │  │ - Telegram    │  │ - 扫描 skills/        ││
│  │               │  │ - Discord     │  │ - dynamic import      ││
│  └───────────────┘  └───────────────┘  │ - 注册到 ToolRegistry ││
│                                        └───────────────────────┘│
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐│
│  │ Signer        │  │ Session       │  │ Loaded Skills         ││
│  │               │  │               │  │ - crypto-price        ││
│  │               │  │               │  │ - crypto-balance      ││
│  └───────────────┘  └───────────────┘  └───────────────────────┘│
│                                                                  │
│  Skills 通过 context 获取能力（原生 fetch、env 等）              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**特点**：
- 简单，无 Docker 依赖
- Skill 与核心在同一进程，共享 Node.js 运行时
- 适合自托管场景（用户自己写 Skill，信任边界模糊）

### 2.2 可选增强：双容器架构 🚫

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host / Docker Network                    │
│                                                                  │
│  ┌─────────────────────────┐    ┌─────────────────────────────┐ │
│  │    Core Container       │    │     Skill Container         │ │
│  │                         │    │                             │ │
│  │  ┌───────────────────┐  │    │  ┌───────────────────────┐  │ │
│  │  │ Gateway           │  │    │  │ Skill Executor        │  │ │
│  │  │ - HTTP Server     │◄─┼────┼─►│ - RPC Server          │  │ │
│  │  │ - Message Router  │  │    │  │ - Skill Loader        │  │ │
│  │  └───────────────────┘  │    │  │ - JS Runtime          │  │ │
│  │                         │    │  └───────────────────────┘  │ │
│  │  ┌───────────────────┐  │    │                             │ │
│  │  │ Channels          │  │    │  ┌───────────────────────┐  │ │
│  │  │ - Telegram        │  │    │  │ Loaded Skills         │  │ │
│  │  │ - Discord         │  │    │  │ - crypto-balance      │  │ │
│  │  └───────────────────┘  │    │  │ - crypto-price        │  │ │
│  │                         │    │  │ - dex-swap            │  │ │
│  │  ┌───────────────────┐  │    │  │ - ...                 │  │ │
│  │  │ Signer (私钥)     │  │    │  └───────────────────────┘  │ │
│  │  │ - Session Key     │  │    │                             │ │
│  │  │ - App Bridge      │  │    │  Volume: /skills (只读)     │ │
│  │  └───────────────────┘  │    │  Network: 仅访问 Core       │ │
│  │                         │    │                             │ │
│  │  ┌───────────────────┐  │    └─────────────────────────────┘ │
│  │  │ Session Store     │  │                                    │
│  │  └───────────────────┘  │                                    │
│  │                         │                                    │
│  │  Network: 完整访问      │                                    │
│  └─────────────────────────┘                                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 容器职责

**Core Container**

- Gateway：消息路由、Tool 调度
- Channels：Telegram/Discord 通信
- Signer：私钥管理、交易签名（永不暴露给 Skill）
- Session：会话存储
- 内置 Tools：memory_search、edit_file 等

**Skill Container**

- Skill Executor：加载和执行 Skills
- RPC Server：接收 Core 的 Tool 调用请求
- JS Runtime：运行 Skill 代码
- 只读挂载 skill 目录
- 网络受限：只能访问 Core Container

### 2.3 通信协议

使用 JSON-RPC 2.0 over HTTP：

```
Core Container                     Skill Container
      │                                  │
      │  POST /rpc                       │
      │  {                               │
      │    "jsonrpc": "2.0",             │
      │    "method": "tool.execute",     │
      │    "params": {                   │
      │      "tool": "get_balance",      │
      │      "args": {...}               │
      │    },                            │
      │    "id": 1                       │
      │  }                               │
      │ ─────────────────────────────────►
      │                                  │
      │  {                               │
      │    "jsonrpc": "2.0",             │
      │    "result": {...},              │
      │    "id": 1                       │
      │  }                               │
      │ ◄─────────────────────────────────
      │                                  │
```

**RPC Methods**

| Method | 方向 | 说明 |
|--------|------|------|
| `tool.execute` | Core → Skill | 执行 Skill Tool |
| `tool.list` | Core → Skill | 列出可用 Tools |
| `skill.reload` | Core → Skill | 重新加载 Skills |
| `core.sign` | Skill → Core | 请求签名（需确认） |
| `core.fetch` | Skill → Core | 代理网络请求（可选） |

---

## 3. Skill 格式定义 ✅

### 3.1 目录结构

```
workspace/skills/
├── crypto-balance/
│   ├── package.json        # 元数据 + owliabot 配置 + 依赖
│   ├── index.js            # 入口文件
│   └── README.md           # 可选，说明文档
│
├── crypto-price/
│   ├── package.json
│   └── index.js
│
└── dex-swap/
    ├── package.json
    ├── index.js
    └── lib/
        └── uniswap.js      # 内部模块
```

### 3.2 package.json 格式

使用标准 package.json，Skill 特有配置放在 `owliabot` 字段：

```json
{
  "name": "crypto-balance",
  "version": "0.1.0",
  "description": "Query token balances across multiple chains",
  "author": "zhixian",
  "license": "MIT",
  "main": "index.js",
  
  "dependencies": {
    "viem": "^2.0.0"
  },
  
  "owliabot": {
    "requires": {
      "env": ["ALCHEMY_API_KEY"]
    },
    "tools": [
      {
        "name": "get_balance",
        "description": "Get native or token balance for an address",
        "parameters": {
          "type": "object",
          "properties": {
            "address": {
              "type": "string",
              "description": "Wallet address (0x...)"
            },
            "chain": {
              "type": "string",
              "enum": ["ethereum", "polygon", "arbitrum", "base"],
              "description": "Blockchain network"
            },
            "token": {
              "type": "string",
              "description": "Token contract address (optional, default: native)"
            }
          },
          "required": ["address", "chain"]
        },
        "security": {
          "level": "read"
        }
      }
    ]
  }
}
```

**字段说明**：

| 字段 | 来源 | 说明 |
|------|------|------|
| `name`, `version`, `description` | 标准 npm | 复用，无需重复 |
| `main` | 标准 npm | 入口文件，默认 `index.js` |
| `dependencies` | 标准 npm | 可选，Skill 依赖 |
| `owliabot.requires.env` | Skill 特有 | 需要的环境变量 |
| `owliabot.tools` | Skill 特有 | Tool 定义列表 |

### 3.3 入口文件格式

**入口文件必须是 JavaScript**。TypeScript 用户请本地编译后提交 `index.js`：

```bash
cd workspace/skills/my-skill
npx tsc index.ts
```

```javascript
// index.js - Skill 入口文件
// 必须导出 tools 对象，key 为 tool name

export const tools = {
  get_balance: async (params, context) => {
    const { address, chain, token } = params;
    
    // 通过 context 获取能力（MVP 是原生，容器化后是代理）
    const apiKey = context.env.ALCHEMY_API_KEY;
    
    // 网络请求
    const response = await context.fetch(`https://...`);
    
    // 返回结果
    return {
      success: true,
      data: {
        address,
        chain,
        balance: "1.5",
        symbol: "ETH"
      }
    };
  }
};
```

### 3.4 Context API

Skill 执行时会收到 context 对象。**接口稳定，底层实现按部署模式变化**。

```typescript
interface SkillContext {
  // 环境变量
  env: Record<string, string>;
  
  // 网络请求
  fetch(url: string, options?: FetchOptions): Promise<Response>;
  
  // 请求签名（会触发用户确认流程）
  sign(request: SignRequest): Promise<SignResult>;
  
  // 读取 workspace 文件
  readFile(path: string): Promise<string>;
  
  // 调用元数据
  meta: {
    skillName: string;
    toolName: string;
    callId: string;
    userId: string;
    channel: string;
  };
}
```

**MVP vs 容器化的 context 实现**：

| 能力 | MVP（单进程） | 容器化 |
|------|---------------|--------|
| `env` | `process.env`（全部或过滤） | 仅 package.json 声明的 |
| `fetch` | `globalThis.fetch`（原生） | RPC 代理到 Core |
| `sign` | 直接调用 Signer | RPC 调用 Core |
| `readFile` | `fs.readFile` | RPC 调用 Core |

**Skill 代码无需关心底层**，始终通过 context 调用：

```javascript
// 这段代码在 MVP 和容器化模式下都能运行
export const tools = {
  get_price: async ({ coin }, context) => {
    const res = await context.fetch(`https://api.example.com/${coin}`);
    // ...
  }
};
```

---

## 4. 加载机制 ✅

### 4.1 启动流程

```
OwliaBot 启动
        │
        ▼
扫描 workspace/skills/ 目录
        │
        ▼
┌────────────────────────┐
│ 对每个 skill 目录       │
│                        │
│  1. 读取 package.json  │
│  2. 解析 owliabot 字段 │
│  3. 验证格式           │
│  4. dynamic import(main)│
│  5. 验证导出格式       │
│  6. 注册到 ToolRegistry │
│                        │
└────────────────────────┘
        │
        ▼
Skill Tools 可用
```

### 4.2 热重载 ⏳

支持运行时重新加载 Skills：

```
/reload-skills 命令
        │
        ▼
清空当前 registry
        │
        ▼
重新扫描 + 加载（绕过缓存）
        │
        ▼
返回新的 tool 列表
```

**缓存绕过**：

Node.js 模块有缓存，需要 cache buster 绕过：

```javascript
// ❌ 第二次 import 返回缓存的旧版本
const { tools } = await import("./skills/crypto-price/index.js");

// ✅ 加 query string 绕过缓存
const cacheBuster = Date.now();
const { tools } = await import(`./skills/crypto-price/index.js?v=${cacheBuster}`);
```

**注意事项**：

- 旧模块内存不会立即释放（等 GC）
- 频繁 reload 可能导致内存增长
- MVP 可接受，生产环境建议重启进程
- 容器化后，直接重启 Skill Container 更干净

**触发方式**：
- 用户命令：`/reload-skills`

### 4.3 依赖管理

**策略：复用主进程依赖 + Skill 自带特殊依赖**

Node.js 模块解析机制天然支持这种模式：

```
import "viem"

解析顺序：
1. ./workspace/skills/my-skill/node_modules/viem
2. ./workspace/skills/node_modules/viem
3. ./node_modules/viem  ← 主进程的依赖
```

**实际效果**：

- 主进程已装 viem 等常用包 → Skill 直接 import ✅（HTTP 用 Node.js 内置 `fetch`）
- 需要特殊依赖 → Skill 目录执行 `npm install` ✅
- 版本冲突 → Skill 自带特定版本覆盖 ✅

**使用方式**：

```bash
# 如需特殊依赖
cd workspace/skills/my-skill
npm install some-special-package
```

生成的 `node_modules/` 只包含主进程没有的包。

### 4.4 Tool 命名规则

**命名空间策略**：Skill tools 使用 `skill-name:tool-name` 格式，避免冲突。

```
echo                         # builtin（无前缀）
memory_search                # builtin
crypto-price:get_price       # skill tool
crypto-balance:get_balance   # skill tool
```

**规则**：

- 无 `:` → builtin tool
- 有 `:` → skill tool

**注册时自动添加前缀**：

```javascript
// Skill Loader
for (const [toolName, toolFn] of Object.entries(skillModule.tools)) {
  const fullName = `${skillName}:${toolName}`;
  registry.register(fullName, toolFn);
}
```

**好处**：

- 多个 Skill 可以有同名 tool（如不同数据源的 `get_price`）
- LLM 看到完整名称，知道调用的是哪个 Skill

### 4.5 执行与错误处理

**超时控制**：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| 默认超时 | 30 秒 | 大多数操作足够 |
| 可配置 | `owliabot.tools[].timeout` | 链上操作可设更长 |

**执行逻辑**：

```javascript
async function executeTool(tool, params, context) {
  const timeout = tool.timeout ?? 30_000;
  
  try {
    const result = await Promise.race([
      tool.execute(params, context),
      rejectAfter(timeout, `Skill execution timeout (${timeout}ms)`),
    ]);
    
    // 自动包装简单返回值
    if (result && typeof result === "object" && !("success" in result)) {
      return { success: true, data: result };
    }
    
    return result;
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
```

**返回格式**：

```javascript
// 推荐：完整格式
return { success: true, data: { balance: "1.5" } };
return { success: false, error: "API rate limited" };

// 也支持：简单返回（自动包装）
return { balance: "1.5" };  // → { success: true, data: { balance: "1.5" } }
```

---

## 5. 安全模型 ⏳

### 5.1 容器级隔离 🚫

**Skill Container 限制**

```yaml
# docker-compose.yml
skill-executor:
  image: owliabot/skill-executor
  volumes:
    - ./workspace/skills:/skills:ro    # 只读挂载
  networks:
    - internal                          # 仅内部网络
  cap_drop:
    - ALL                               # 移除所有 capabilities
  security_opt:
    - no-new-privileges:true
  read_only: true                       # 只读文件系统
  tmpfs:
    - /tmp                              # 临时目录用 tmpfs
  mem_limit: 512m
  cpus: 1
```

**网络隔离**

```yaml
networks:
  internal:
    internal: true    # 无法访问外部网络
  external:
    # Core Container 使用，可访问外部
```

Skill 网络请求通过 `context.fetch()` 进行，容器化模式下会代理到 Core。

### 5.2 权限分级 ⏳

| 级别 | 说明 | 示例 | 确认 |
|------|------|------|------|
| `read` | 只读查询 | 查余额、查价格 | 无需 |
| `write` | 修改本地状态 | 写 memory 文件 | Inline 按钮 |
| `sign` | 需要签名 | 转账、swap | Transaction Page |

**权限检查流程**

```
Tool 调用请求
      │
      ▼
检查 tool.security.level
      │
      ├─ read ──────────► 直接执行
      │
      ├─ write ─────────► Inline 确认 ──► 执行
      │
      └─ sign ──────────► Transaction Page ──► Signer ──► 执行
```

### 5.3 环境变量隔离

Skill 只能访问 package.json 中声明的环境变量：

```json
{
  "owliabot": {
    "requires": {
      "env": ["ALCHEMY_API_KEY", "COINGECKO_API_KEY"]
    }
  }
}
```

未声明的环境变量（如 `TELEGRAM_BOT_TOKEN`、私钥相关）不会传入 Skill Container。

---

## 6. 认证方案（分阶段） ⏳

### 6.1 MVP：本地信任 ✅

只加载 `workspace/skills/` 目录下的 Skill。

用户自己放的代码，自己负责。

无需额外实现。

### 6.2 Phase 2：仓库信任 🚫

支持从信任的仓库安装 Skill。

**配置**

```yaml
# config.yaml
skills:
  repositories:
    - name: official
      url: https://skills.owliabot.io
      trusted: true
    - name: community
      url: https://community-skills.example.com
      trusted: false    # 安装时警告
```

**安装流程**

```
owliabot skill install crypto-balance

      │
      ▼
从仓库获取元数据
      │
      ▼
下载 skill 包
      │
      ▼
验证 SHA256 哈希
      │
      ▼
解压到 workspace/skills/
      │
      ▼
重载 skills
```

**仓库 API**

```
GET /skills                     # 列出所有 skills
GET /skills/{name}              # 获取 skill 元数据
GET /skills/{name}/versions     # 获取版本列表
GET /skills/{name}/{version}    # 下载 skill 包
```

### 6.3 Phase 3：代码签名 🚫

为高安全场景提供代码签名验证。

**签名流程**

1. 开发者生成密钥对
2. 向官方申请证书（审核通过后签发）
3. 用私钥签名 skill 包
4. 发布到仓库

**验证流程**

1. 下载 skill 包 + 签名
2. 获取开发者证书
3. 验证证书链（开发者证书 → 官方根证书）
4. 验证签名
5. 通过后加载

**证书结构**

```
官方根证书 (root.crt)
    │
    └── 开发者证书 (developer-xxx.crt)
            │
            └── Skill 签名 (skill.sig)
```

---

## 7. 接口定义 ✅

### 7.1 Skill Executor RPC

```typescript
// Skill Container 暴露的 RPC 接口

interface SkillExecutorRPC {
  // 执行 tool
  "tool.execute": (params: {
    tool: string;           // tool 名称
    args: unknown;          // tool 参数
    context: ToolContext;   // 执行上下文
  }) => Promise<ToolResult>;
  
  // 列出所有 tools
  "tool.list": () => Promise<ToolInfo[]>;
  
  // 重新加载 skills
  "skill.reload": () => Promise<{
    loaded: string[];
    failed: Array<{ name: string; error: string }>;
  }>;
  
  // 健康检查
  "health": () => Promise<{ status: "ok" }>;
}

interface ToolInfo {
  name: string;
  skill: string;
  description: string;
  parameters: JSONSchema;
  security: { level: "read" | "write" | "sign" };
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

### 7.2 Core RPC（Skill 可调用）

```typescript
// Core Container 暴露给 Skill 的 RPC 接口

interface CoreRPC {
  // 代理网络请求
  "core.fetch": (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>;
  
  // 请求签名（触发用户确认）
  "core.sign": (params: {
    type: "message" | "transaction";
    data: SignRequest;
  }) => Promise<SignResult>;
  
  // 读取 workspace 文件（只读）
  "core.readFile": (params: {
    path: string;   // 相对于 workspace
  }) => Promise<{ content: string }>;
}
```

---

## 8. 实现计划

### 8.1 MVP（1 周） ✅

- [ ] Skill 加载器：扫描目录、解析 package.json、dynamic import
- [ ] Skill Registry：管理已加载的 tools
- [ ] Context 构建：提供原生 fetch、env、sign 等能力
- [ ] 集成到 ToolRegistry：Skill tools 与 builtin tools 统一管理
- [ ] 1-2 个示例 Skill：crypto-price、crypto-balance

### 8.2 Phase 2：仓库支持（1 周） 🚫

- [ ] `owliabot skill install` 命令
- [ ] 仓库 API 客户端
- [ ] 哈希验证

### 8.3 Phase 3：容器隔离（可选，1 周） 🚫

- [ ] Skill Executor 独立服务
- [ ] JSON-RPC 通信
- [ ] Docker Compose 配置
- [ ] Context 能力代理

### 8.4 Phase 4：代码签名（按需） 🚫

- [ ] 签名生成工具
- [ ] 证书验证逻辑
- [ ] PKI 基础设施

---

## 9. 示例 Skills

### 9.1 crypto-price

查询加密货币价格。

```json
// package.json
{
  "name": "crypto-price",
  "version": "0.1.0",
  "description": "Get cryptocurrency prices from CoinGecko",
  "main": "index.js",
  "owliabot": {
    "tools": [
      {
        "name": "get_price",
        "description": "Get current price of a cryptocurrency",
        "parameters": {
          "type": "object",
          "properties": {
            "coin": { "type": "string", "description": "Coin ID (e.g., bitcoin, ethereum)" },
            "currency": { "type": "string", "default": "usd" }
          },
          "required": ["coin"]
        },
        "security": { "level": "read" }
      }
    ]
  }
}
```

```javascript
// index.js
export const tools = {
  get_price: async ({ coin, currency = "usd" }, context) => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${currency}`;
    const res = await context.fetch(url);
    const data = await res.json();
    
    if (!data[coin]) {
      return { success: false, error: `Coin not found: ${coin}` };
    }
    
    return {
      success: true,
      data: {
        coin,
        currency,
        price: data[coin][currency]
      }
    };
  }
};
```

### 9.2 crypto-balance

查询钱包余额。

```json
// package.json
{
  "name": "crypto-balance",
  "version": "0.1.0",
  "description": "Query wallet balances across chains",
  "main": "index.js",
  "owliabot": {
    "requires": {
      "env": ["ALCHEMY_API_KEY"]
    },
    "tools": [
      {
        "name": "get_balance",
        "description": "Get native token balance",
        "parameters": {
          "type": "object",
          "properties": {
            "address": { "type": "string" },
            "chain": { "type": "string", "enum": ["ethereum", "polygon", "arbitrum"] }
          },
          "required": ["address", "chain"]
        },
        "security": { "level": "read" }
      }
    ]
  }
}
```

```javascript
// index.js
const RPC_URLS = {
  ethereum: "https://eth-mainnet.g.alchemy.com/v2/",
  polygon: "https://polygon-mainnet.g.alchemy.com/v2/",
  arbitrum: "https://arb-mainnet.g.alchemy.com/v2/"
};

export const tools = {
  get_balance: async ({ address, chain }, context) => {
    const url = RPC_URLS[chain] + context.env.ALCHEMY_API_KEY;
    
    const res = await context.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [address, "latest"],
        id: 1
      })
    });
    
    const data = await res.json();
    const balanceWei = BigInt(data.result);
    const balanceEth = Number(balanceWei) / 1e18;
    
    return {
      success: true,
      data: {
        address,
        chain,
        balance: balanceEth.toFixed(6),
        symbol: chain === "polygon" ? "MATIC" : "ETH"
      }
    };
  }
};
```

---

_创建于 2026-01-27_

---

## 实现状态图例

- ✅ 已实现且测试通过
- ⏳ 部分实现或进行中
- 🚫 未开始或设计已废弃

_最后更新: 2026-02-04_
