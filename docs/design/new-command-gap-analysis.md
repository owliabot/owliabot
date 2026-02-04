# /new 命令：OpenClaw 对标差距分析

## OpenClaw 完整行为（源码分析）

| # | 行为 | 实现位置 |
|---|------|----------|
| 1 | **触发匹配**：`/new`, `/reset`（可配 `resetTriggers`），**大小写不敏感**，群聊先 strip mention | `session.ts` |
| 2 | **权限检查**：仅 authorized sender 可触发，未授权静默忽略 | `commands-core.ts` |
| 3 | **Session 轮转**：新 UUID，重置 compactionCount/memoryFlush，**保留** thinkingLevel/verboseLevel/reasoningLevel/ttsAuto/modelOverride/providerOverride/sendPolicy/queueMode | `session.ts` |
| 4 | **模型切换**：`/new sonnet` 解析 remainder 为模型别名/名称，应用为 session override，支持 `provider/model`、别名、模糊匹配 | `session-reset-model.ts` |
| 5 | **Hook 系统**：触发 `command:new` / `command:reset` 内部 hook，handler 可追加消息 | `internal-hooks.js` |
| 6 | **Greeting**：`"✅ New session started · model: {provider}/{model}"`，如果模型≠默认则显示 `(default: ...)` | `get-reply-run.js` |
| 7 | **Memory**：`/new` 时 **不做** 自动摘要。有独立的 pre-compaction memory flush 机制（接近 context window 上限时注入 prompt 让 agent 写 memory） | `memory-flush.js` |
| 8 | **Bare reset prompt**：bare `/new`（无 remainder）注入 `BARE_SESSION_RESET_PROMPT`，让 agent 说句简短的 hi + 问用户想做什么 | `get-reply-run.js` |
| 9 | **Session 文件**：创建新 JSONL 文件，支持从 parent session fork | `session.ts` |
| 10 | **Auto-reset**：支持 daily/idle 自动重置，per-type override（dm/group/thread） | `sessions.ts` |

## 当前 owliabot 实现 vs OpenClaw

| 特性 | OpenClaw | owliabot 当前 | 差距 | 优先级 |
|------|----------|---------------|------|--------|
| 触发匹配 | 大小写不敏感 + mention strip | 大小写敏感，无 mention strip | ⚠️ 小差距 | **P0** |
| 权限检查 | ✅ authorized sender only | ❌ 任何人可触发 | ⚠️ 安全问题 | **P0** |
| Session 轮转 | rotate + 保留 overrides | rotate（不保留，因为还没 overrides） | ✅ 当前无 overrides 可保留 | P2 |
| 模型切换 `/new sonnet` | ✅ 完整实现 | ❌ remainder 只显示不解析 | 🔴 核心功能缺失 | **P0** |
| Greeting 格式 | `✅ New session · model: X` | `🆕 新会话已开启...` | ⚠️ 风格差异 | **P1** |
| Greeting 显示模型 | ✅ 始终显示当前模型 | ❌ 不显示 | ⚠️ 信息缺失 | **P1** |
| Memory on reset | ❌ 不做（靠 pre-compaction flush） | ✅ LLM 摘要写入 memory/ | 🟡 **比 OpenClaw 多了一步** | P1（讨论） |
| Bare reset prompt | ✅ 注入 agent prompt | ❌ 直接发固定消息 | ⚠️ 行为差异 | **P1** |
| Hook 系统 | ✅ 事件驱动 | ❌ 无 | 🟡 扩展性 | P2 |
| Pre-compaction flush | ✅ token 接近上限时自动 flush | ❌ 无 | 🟡 大差距但复杂 | P2 |
| Auto-reset (daily/idle) | ✅ 完整 | ❌ 无 | 🟡 独立 feature | P2 |
| Thread 支持 | ✅ 调整 reset type | ❌ 无 | P2 |

## 推荐改动

### P0 — 必须立即修复

#### 1. 大小写不敏感匹配
- **现状**：`/NEW` 不会被识别
- **改法**：trigger 匹配时 `.toLowerCase()` 对比
- **复杂度**：极低（2 行代码）

#### 2. 权限检查
- **现状**：群聊中任何人都能 `/new` 重置 bot 的会话
- **改法**：`CommandContext` 增加 `isAuthorizedSender` 检查，对标 owliabot 已有的 `memberAllowList` / Discord `requireMentionInGuild`
- **复杂度**：低（需要从 config 读 allowlist，在 tryHandleCommand 开头检查）

#### 3. 模型切换 `/new sonnet`
- **现状**：remainder 只显示在 greeting 中
- **改法**：
  1. 尝试将 remainder 解析为模型别名/名称（复用 `models.ts` 的 `MODEL_ALIASES`）
  2. 如果匹配到模型 → 应用为 session override（需要 sessionStore 支持 model override 字段）
  3. 剩余部分作为首条消息
- **复杂度**：中（需要 model resolution + session store schema 扩展）
- **简化方案**：先只支持精确别名匹配（不做模糊），不改 session store schema（只在 greeting 中显示）

### P1 — 应该有

#### 4. Greeting 格式对齐
- **改法**：`"✅ New session started · model: {provider}/{model}"`
- 如果模型切换了，显示 `(default: ...)`
- **复杂度**：低

#### 5. Memory 策略决策
- **OpenClaw 方式**：不在 `/new` 时做摘要。Memory 由 agent 自主写 + pre-compaction flush 触发。
- **owliabot 当前方式**：`/new` 前 LLM 摘要 → `memory/YYYY-MM-DD.md`
- **建议**：**保留当前的 LLM 摘要**（作为 owliabot 的增值功能），但标注为可选 (`summarizeOnReset: true/false`)。理由：
  - owliabot 没有 pre-compaction flush，如果不在 `/new` 时摘要，memory 就完全丢失
  - 等 pre-compaction flush 实现后，可以考虑关闭 `/new` 时的摘要
- **复杂度**：低（已实现，只需加 config 开关）

#### 6. Bare reset prompt
- **OpenClaw 方式**：bare `/new` 注入 `BARE_SESSION_RESET_PROMPT` 让 agent 在 LLM loop 中生成 greeting
- **owliabot 当前方式**：直接发固定文本 greeting（不经过 LLM）
- **建议**：暂时保持固定文本（不增加一次 LLM 调用），但如果后续需要更智能的 greeting 再切换
- **复杂度**：中（需要修改 handleMessage 流程，让 `/new` 的 remainder 经过 LLM loop）

### P2 — 锦上添花

#### 7. Hook/Event 系统
- 类似 OpenClaw 的 `registerInternalHook('command:new', handler)`
- 适合插件化扩展
- **复杂度**：中

#### 8. Pre-compaction memory flush
- 接近 context window 上限时自动让 agent 写 memory
- **复杂度**：高（需要 token 计数 + compaction 机制）

#### 9. Auto-reset (daily/idle)
- Session 自动过期重置
- **复杂度**：中

#### 10. Session state preservation
- 保留 model override / thinking level 等跨 reset
- **复杂度**：低（但前提是这些 feature 先实现）

## 实现路线

**Phase 1（本 PR）：P0 + P1 核心**
1. ✅ 大小写不敏感匹配
2. ✅ 权限检查（基于 config allowlist）
3. ✅ 模型切换（精确别名匹配）
4. ✅ Greeting 格式对齐
5. ✅ Memory 摘要加 config 开关

**Phase 2（后续 PR）：**
- Bare reset prompt（LLM 生成 greeting）
- Hook 系统
- Auto-reset

**Phase 3（长期）：**
- Pre-compaction memory flush
- Session state preservation
