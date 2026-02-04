# Write-Tools 确认/权限门 设计文档

## 1. 问题

当前 owliabot 的 write 级别工具（如 `edit_file`）因安全考虑已在 `executor.ts` 中被硬编码禁用：

```typescript
// MVP: Only allow read-level tools without confirmation
if (tool.security.level !== "read") {
  return { success: false, error: `Tool ${call.name} requires confirmation (not implemented in MVP)` };
}
```

这意味着 LLM 无法执行任何文件编辑操作。我们需要一个安全的权限门控机制来重新启用 write 工具。

## 2. 方案概述

采用**双层防护**架构：

```
LLM 请求 write 工具
       │
       ▼
  ┌─────────────┐    拒绝
  │ 用户白名单   │──────────► 返回错误
  │ (allowlist)  │
  └──────┬──────┘
         │ 通过
         ▼
  ┌─────────────┐    超时/拒绝
  │  确认流程    │──────────► 返回错误
  │ (confirm)   │
  └──────┬──────┘
         │ 批准
         ▼
    执行工具
         │
         ▼
    审计日志
```

### 第一层：用户白名单

- 配置项 `security.writeToolAllowList: string[]`
- 包含 Discord user ID 和/或 Telegram user ID
- 只有在白名单中的用户发起的会话才能触发 write 工具
- 空白名单 = 完全禁用 write 工具（等同现状）

### 第二层：操作确认

- 配置项 `security.writeToolConfirmation: boolean`（默认 `true`）
- 当 write 工具即将执行时，bot 发送确认消息到当前会话频道
- 消息格式：

```
⚠️ Write Operation Requested

Tool: edit_file
File: memory/notes.md
Old text: (前50字符)...
New text: (前50字符)...

Reply "yes" to approve or "no" to deny. (60s timeout)
```

- 等待用户在同一频道回复 `yes`/`no`
- 只接受**同一用户**的回复（防止他人代批）

## 3. 配置 Schema 变更

在 `configSchema` 中新增 `security` 字段：

```typescript
const securitySchema = z.object({
  writeToolAllowList: z.array(z.string()).default([]),
  writeToolConfirmation: z.boolean().default(true),
  writeToolConfirmationTimeoutMs: z.number().int().default(60_000),
});

// 添加到 configSchema
security: securitySchema.optional(),
```

## 4. 核心模块：`WriteGate`

### 4.1 接口设计

```typescript
interface WriteGateOptions {
  allowList: string[];
  confirmationEnabled: boolean;
  timeoutMs: number;
  auditPath: string;
  sendMessage: (target: string, msg: OutboundMessage) => Promise<void>;
  waitForReply: (target: string, fromUser: string, timeoutMs: number) => Promise<string | null>;
}

interface WriteGateResult {
  allowed: boolean;
  reason: "approved" | "denied" | "timeout" | "not_in_allowlist" | "confirmation_disabled_allow";
}
```

### 4.2 执行流程

```typescript
async function checkWritePermission(
  toolCall: ToolCall,
  userId: string,
  sessionKey: string,
): Promise<WriteGateResult>
```

1. 检查 `userId` 是否在 `allowList` 中 → 不在则拒绝
2. 若 `confirmationEnabled === false` → 直接放行（信任白名单）
3. 发送确认消息到会话频道
4. 等待用户回复（60s 超时）
5. 解析回复：`yes`/`y`/`confirm` → 批准；其他 → 拒绝
6. 记录审计日志

### 4.3 集成点

修改 `src/agent/tools/executor.ts`：

```typescript
// 替换原有的硬编码拒绝
if (tool.security.level !== "read") {
  const gate = getWriteGate(); // 从 DI 或全局获取
  const result = await gate.check(call, ctx);
  if (!result.allowed) {
    return { success: false, error: `Write denied: ${result.reason}` };
  }
}
```

## 5. 审计日志

所有 write 工具调用记录到 `workspace/audit.jsonl`：

```jsonl
{"ts":"2026-02-04T01:55:00Z","tool":"edit_file","user":"123456","session":"discord:123456","params":{"path":"notes.md"},"result":"approved","durationMs":3200}
{"ts":"2026-02-04T01:56:00Z","tool":"edit_file","user":"789012","session":"telegram:789012","params":{"path":"config.yaml"},"result":"not_in_allowlist","durationMs":0}
```

字段：
- `ts` — ISO 时间戳
- `tool` — 工具名
- `user` — 请求者 ID
- `session` — 会话 key
- `params` — 工具参数（脱敏，仅保留 path 等关键字段）
- `result` — approved / denied / timeout / not_in_allowlist
- `durationMs` — 确认等待耗时

## 6. 边界情况处理

### 6.1 用户确认了错误操作

**风险**：LLM 生成了错误的 edit 参数，用户没仔细看就批准了。

**缓解措施**：
- 确认消息中显示完整操作详情（文件路径、修改内容摘要）
- 对于 `edit_file`，显示 old_text 和 new_text 的前 200 字符
- 审计日志保留完整参数，便于事后追溯
- 未来可增加 git 自动提交/回滚机制

### 6.2 并发确认请求

**场景**：LLM 在一次回复中发出多个 write tool call。

**处理**：
- 串行处理确认（当前 `executeToolCalls` 已经是串行的）
- 每个 write 操作独立确认
- 使用 `pendingConfirmations` Map 跟踪状态，key 为 `sessionKey`
- 同一会话同时只允许一个待确认请求，后续请求排队

### 6.3 确认消息回复冲突

**场景**：频道中其他用户回复了 "yes"。

**处理**：
- `waitForReply` 过滤条件：必须是 `fromUser === requestingUser`
- 只接受发起会话的用户的回复

### 6.4 Bot 重启期间的待确认请求

**处理**：
- 待确认状态保存在内存中，重启后丢失
- 相当于自动超时拒绝（安全优先）
- 审计日志已写入磁盘，不受影响

### 6.5 sign 级别工具

- `sign` 级别工具（如加密签名）需要更严格的确认流程
- 本方案先覆盖 `write` 级别
- `sign` 级别可复用此框架，未来加入交易详情展示等

## 7. 实现计划

### Phase 1（本 PR）
- [ ] `WriteGate` 核心类
- [ ] config schema 变更
- [ ] executor.ts 集成
- [ ] 审计日志
- [ ] 单元测试

### Phase 2（后续）
- [ ] Discord 按钮式确认（替代文字回复）
- [ ] 批量操作的一次性确认（"approve all 3 edits?"）
- [ ] Git auto-commit before write（回滚安全网）
- [ ] Web UI 审计日志查看器
