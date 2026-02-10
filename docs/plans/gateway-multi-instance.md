# RFC: Gateway 多实例设计

## 背景

当前 owliabot Gateway 是单进程架构。所有状态（session、device pairing、API key、events、rate limit）要么在 SQLite 要么在 JSON 文件中，只能单实例访问。

随着使用场景扩展（多 channel、高并发 tool 调用、HA 需求），需要支持多 Gateway 实例共享状态。

## 目标

支持 N 个 Gateway 实例同时运行，共享：
- Session 状态（谁在哪个会话中）
- Device/API Key 认证（任一实例都能验证）
- Events（设备从任意实例 poll 到完整事件流）
- Rate limit（全局计数，不是每实例独立计）

**不共享**（每实例独立）：
- ToolRegistry（每个实例加载自己的工具集，可以相同也可以不同）
- Agent loop / LLM 调用（每个实例独立处理请求）
- Channel 连接（每个实例连自己的 Discord/Telegram bot，或 load balance）

## 当前状态分析

| 组件 | 存储方式 | 并发问题 | 多实例方案 |
|------|----------|----------|------------|
| SessionStore | JSON + lockfile | 文件锁，单写 | 迁移到 SQLite 或 Redis |
| InfraStore (HTTP) | SQLite `infra.db` | SQLite WAL 支持并发读 | 共享 SQLite (WAL) 或 Redis |
| HTTP Store | SQLite（同 infra.db）| 同上 | 同上 |
| Transcripts | JSONL 文件 | append-only，较安全 | 共享文件系统 / 对象存储 |
| ToolRegistry | 内存 | 无并发问题 | 每实例独立加载 |
| Cron | 内存 timer | 多实例会重复触发 | 分布式锁 / leader election |

## 方案选择

### 方案 A：SQLite WAL 共享（推荐起步方案）

**思路**：所有实例访问同一个 SQLite 文件（WAL 模式），通过文件系统共享。

**优点**：
- 改动最小 — InfraStore 已经是 SQLite，只需迁移 SessionStore
- SQLite WAL 支持并发读 + 单写（写自动排队）
- 不引入新依赖（无需 Redis）
- 适合 2-4 实例的规模

**缺点**：
- 需要共享文件系统（NFS、EFS、或同一台机器多进程）
- 写并发有限（SQLite 单写锁）
- 不适合跨数据中心

**改动范围**：

1. **SessionStore 迁移到 SQLite**
   - 新建 `sessions` 表替代 `sessions.json`
   - 接口不变（`getOrCreate`, `rotate`, `listKeys`, `get`）
   - 删除文件锁逻辑

2. **Cron 分布式锁**
   - 在 SQLite 中加 `cron_locks` 表
   - 每个 cron job 执行前尝试获取锁（`INSERT OR IGNORE` + TTL）
   - 只有获得锁的实例执行，其他跳过

3. **Events 跨实例可见**
   - 已经在 SQLite，无需改动
   - 设备从任意实例 poll 都能拿到完整事件流

4. **Rate Limit 全局计数**
   - 已经在 SQLite，无需改动
   - 自然全局共享

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Gateway 1│  │ Gateway 2│  │ Gateway 3│
│ (Discord)│  │(Telegram)│  │(HTTP API)│
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     ▼             ▼             ▼
┌─────────────────────────────────────┐
│        Shared SQLite (WAL)          │
│  sessions · devices · api_keys ·   │
│  events · rate_limits · cron_locks  │
└─────────────────────────────────────┘
         (shared filesystem)
```

### 方案 B：Redis 共享（扩展方案）

**思路**：用 Redis 替代 SQLite 做共享状态层。

**优点**：
- 真正的分布式，跨机器/数据中心
- 高写并发
- Pub/Sub 可用于实例间通信（事件广播）
- 天然支持 TTL（rate limit、idempotency 自动过期）

**缺点**：
- 引入新依赖（Redis 服务）
- 数据不持久（需配置 AOF/RDB）
- 运维复杂度增加
- 对小规模部署 overkill

**改动范围**：
- 抽象 Store 接口，实现 Redis 适配器
- SessionStore → Redis Hash
- Device/API Key → Redis Hash
- Events → Redis Stream
- Rate Limit → Redis `INCR` + `EXPIRE`
- Cron Lock → Redis `SET NX EX`

### 方案 C：混合（SQLite + Redis Pub/Sub）

SQLite 做持久化，Redis 只做实例间通知（事件广播、缓存失效）。

## 推荐路径

**Phase 3.3a：SQLite WAL 多实例（先做）**
- SessionStore 迁到 SQLite
- Cron 分布式锁
- 验证 2-3 实例并发工作
- 工作量：~2d

**Phase 3.3b：Redis 适配器（按需）**
- 抽象 Store 接口
- 实现 Redis 适配器
- 配置选择 `store.backend: "sqlite" | "redis"`
- 工作量：~3d

## 详细设计：Phase 3.3a

### 1. SessionStore SQLite 迁移

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  channel TEXT,
  chat_type TEXT,
  group_id TEXT,
  display_name TEXT
);
```

```typescript
// src/agent/session-store.ts — 新增 SQLite 实现
export function createSqliteSessionStore(db: Database): SessionStore {
  // 建表
  // getOrCreate: INSERT OR IGNORE + SELECT
  // rotate: UPDATE session_id = randomUUID()
  // listKeys: SELECT session_key
  // get: SELECT WHERE session_key = ?
}
```

**迁移策略**：
- 检测到 `sessions.json` 存在时，自动导入到 SQLite
- 导入完成后重命名为 `sessions.json.migrated`
- 新安装直接用 SQLite

### 2. Cron 分布式锁

```sql
CREATE TABLE IF NOT EXISTS cron_locks (
  job_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

```typescript
function tryAcquireLock(jobId: string, instanceId: string, ttlMs: number): boolean {
  const now = Date.now();
  // 先清理过期锁
  db.prepare("DELETE FROM cron_locks WHERE expires_at < ?").run(now);
  // 尝试获取
  const result = db.prepare(
    "INSERT OR IGNORE INTO cron_locks(job_id, instance_id, acquired_at, expires_at) VALUES(?,?,?,?)"
  ).run(jobId, instanceId, now, now + ttlMs);
  return result.changes > 0;
}
```

### 3. 实例标识

每个 Gateway 实例启动时生成唯一 ID：

```typescript
const INSTANCE_ID = `gw-${hostname()}-${process.pid}-${Date.now().toString(36)}`;
```

用于：
- Cron 锁归属
- 日志标识
- 健康检查（`/health` 返回 `instanceId`）

### 4. 配置

```yaml
gateway:
  # 多实例配置
  instance:
    id: auto  # 或手动指定
  store:
    backend: sqlite  # "sqlite" | "redis" (future)
    sqlite:
      path: /shared/owliabot/gateway.db
      walMode: true  # 默认开启
```

### 5. 健康检查增强

```
GET /health
{
  "ok": true,
  "version": "0.2.0",
  "instanceId": "gw-host1-12345-m3k2j",
  "uptime": 3600,
  "sessions": 42,
  "connectedChannels": ["discord", "http"]
}
```

## 测试计划

### 单元测试
1. SQLite SessionStore：CRUD、并发读写、迁移
2. Cron 分布式锁：获取、释放、过期、竞争

### 集成测试
3. 启动 2 个 Gateway 实例共享同一 SQLite
4. 实例 A 创建 session → 实例 B 能读到
5. 实例 A 创建 API key → 实例 B 能验证
6. 设备配对在实例 A → 实例 B 能 poll events
7. Cron job 只被一个实例执行

### E2E 测试
8. 完整流程：2 实例 + 设备调 tool + poll events + 验证一致性

## 验收标准

- [ ] SessionStore 从 JSON 迁移到 SQLite（向后兼容自动迁移）
- [ ] Cron 分布式锁防止重复执行
- [ ] 2 个 Gateway 实例共享状态可正常工作
- [ ] `/health` 返回实例标识
- [ ] 现有所有测试通过
- [ ] 新增并发/多实例测试
