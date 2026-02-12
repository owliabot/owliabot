# Context Window Guard — 实现计划

## 问题

OwliaBot 当前没有任何 input token 限制机制：
- 工具输出无截断，大返回值直接塞进 prompt
- `getHistory(maxTurns=20)` 只按轮次截断，不感知 token 量
- 没有 compaction / pruning 机制
- 一旦 context 超出 model 的 window，API 调用直接报错

## 目标

分三层防护，按优先级实施：

| 层 | 机制 | 效果 | 预计工时 |
|----|------|------|----------|
| L1 | 工具输出截断 | 单个 tool result 不超过 maxChars | 2h |
| L2 | Context window 感知 + 历史裁剪 | 发 LLM 前确保总 token < window | 3h |
| L3 | 配置化 + 日志 | 可调参数 + 截断/裁剪事件记录 | 1h |

本次 **不做** 自动 compaction（摘要压缩），留到后续迭代。

---

## L1: 工具输出截断

### 改动文件
- `src/agent/runner.ts` — `toContext()` 函数

### 方案
在 `toContext()` 中序列化 tool result 后，对超长文本做 head+tail 截断：

```typescript
// src/agent/context-guard.ts (新文件)

/** 默认单个工具输出最大字符数 */
export const DEFAULT_TOOL_RESULT_MAX_CHARS = 50_000;

/** head/tail 各保留的字符数 */
export const TRUNCATE_HEAD_CHARS = 2_000;
export const TRUNCATE_TAIL_CHARS = 2_000;

/**
 * 截断超长文本，保留首尾，中间用省略标记替换
 */
export function truncateToolResult(text: string, maxChars = DEFAULT_TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  
  const head = text.slice(0, TRUNCATE_HEAD_CHARS);
  const tail = text.slice(-TRUNCATE_TAIL_CHARS);
  const omitted = text.length - TRUNCATE_HEAD_CHARS - TRUNCATE_TAIL_CHARS;
  
  return `${head}\n\n... [${omitted} characters truncated] ...\n\n${tail}`;
}
```

在 `toContext()` 的 tool result 循环中调用：
```typescript
const resultText = tr.success
  ? JSON.stringify(tr.data, null, 2)
  : `Error: ${tr.error}`;

// L1: 截断超长工具输出
const truncatedText = truncateToolResult(resultText);
```

### 测试
- 短文本不截断
- 超长文本正确截断，保留 head+tail
- 截断后包含省略标记和原始长度信息
- 边界值（刚好 maxChars、maxChars+1）

---

## L2: Context Window 感知 + 历史裁剪

### 改动文件
- `src/agent/context-guard.ts` — 新增估算和裁剪逻辑
- `src/agent/runner.ts` — 在 `runLLM()` / `callWithFailover()` 中调用
- `src/agent/models.ts` — 导出 context window 查询

### 方案

#### 2a. 获取 model 的 context window
```typescript
// src/agent/models.ts 新增
export function getContextWindow(config: ModelConfig): number {
  const model = resolveModel(config);
  return model.contextWindow ?? 200_000; // pi-ai 模型自带 contextWindow
}
```

#### 2b. 估算 context token 数
```typescript
// src/agent/context-guard.ts 新增

/** 粗估：1 token ≈ 4 chars（英文），中文约 2 chars/token，取保守值 3 */
const CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateContextTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
    if (m.toolCalls) {
      total += estimateTokens(JSON.stringify(m.toolCalls));
    }
    if (m.toolResults) {
      for (const tr of m.toolResults) {
        total += estimateTokens(
          tr.success ? JSON.stringify(tr.data) : (tr.error ?? "")
        );
      }
    }
  }
  return total;
}
```

#### 2c. 裁剪历史
```typescript
export interface GuardOptions {
  contextWindow: number;
  reserveTokens?: number;    // 留给输出的 token，默认 8192
  maxToolResultChars?: number; // L1 截断阈值
}

/**
 * 确保 messages 总 token 不超过 contextWindow - reserveTokens。
 * 策略：从最旧的非 system 消息开始丢弃整轮（user+assistant+tool），
 * 直到估算 token 在预算内。
 */
export function guardContext(
  messages: Message[],
  options: GuardOptions
): { messages: Message[]; dropped: number } {
  const budget = options.contextWindow - (options.reserveTokens ?? 8192);
  
  // 先对所有 tool result 做 L1 截断
  const truncated = messages.map(m => truncateMessageToolResults(m, options.maxToolResultChars));
  
  // 分离 system prompt
  const systemMsgs = truncated.filter(m => m.role === "system");
  const chatMsgs = truncated.filter(m => m.role !== "system");
  
  // system prompt 始终保留，从预算中扣除
  const systemTokens = estimateContextTokens(systemMsgs);
  let remaining = budget - systemTokens;
  
  // 从最新消息往回累加，找到能放下的起始位置
  let startIndex = chatMsgs.length;
  let accumulated = 0;
  
  for (let i = chatMsgs.length - 1; i >= 0; i--) {
    const msgTokens = estimateContextTokens([chatMsgs[i]]);
    if (accumulated + msgTokens > remaining) break;
    accumulated += msgTokens;
    startIndex = i;
  }
  
  const kept = chatMsgs.slice(startIndex);
  const dropped = chatMsgs.length - kept.length;
  
  return {
    messages: [...systemMsgs, ...kept],
    dropped,
  };
}
```

#### 2d. 集成到 runner
在 `toContext()` 调用前插入 guard：

```typescript
// runner.ts — runLLM() 中
const contextWindow = model.contextWindow ?? 200_000;
const { messages: guarded, dropped } = guardContext(messages, {
  contextWindow,
  reserveTokens: options?.maxTokens ?? 4096,
  maxToolResultChars: DEFAULT_TOOL_RESULT_MAX_CHARS,
});

if (dropped > 0) {
  log.warn(`Context guard: dropped ${dropped} old messages to fit context window (${contextWindow} tokens)`);
}

const context = toContext(guarded, options?.tools, model);
```

### 测试
- 短对话不裁剪
- 超长对话裁剪最旧消息，保留最新
- system prompt 始终保留
- 裁剪后 token 估算 < budget
- tool result 截断 + 历史裁剪组合生效
- 边界：只有 system + 1 条 user（不裁剪）
- 边界：单条消息就超预算（至少保留最新 1 条）

---

## L3: 配置化 + 日志

### 改动文件
- `src/config/schema.ts` — 新增 context guard 配置字段
- `src/agent/context-guard.ts` — 从 config 读取参数

### 配置 schema
```yaml
# config.yaml
agent:
  contextGuard:
    enabled: true                    # 默认开启
    maxToolResultChars: 50000        # 单个工具输出上限
    reserveTokens: 8192              # 留给输出的 token
    truncateHeadChars: 2000          # 截断时保留的头部
    truncateTailChars: 2000          # 截断时保留的尾部
    contextWindowOverride: null      # 覆盖 model 的 contextWindow（可选）
```

### 日志
截断和裁剪事件通过现有 `tslog` 输出 warn 级别：
- `Context guard: truncated tool result for "${toolName}" (${original} → ${truncated} chars)`
- `Context guard: dropped ${count} old messages (estimated ${droppedTokens} tokens)`

---

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agent/context-guard.ts` | **新建** | 截断 + 估算 + 裁剪核心逻辑 |
| `src/agent/__tests__/context-guard.test.ts` | **新建** | 单元测试 |
| `src/agent/runner.ts` | **修改** | toContext() 集成截断；runLLM() 集成裁剪 |
| `src/agent/models.ts` | **修改** | 导出 getContextWindow() |
| `src/config/schema.ts` | **修改** | 新增 contextGuard 配置 |
| `docs/design/context-window-guard-plan.md` | **新建** | 本计划文档 |

## 不在本次 scope 的

- 自动 compaction（LLM 摘要压缩）— 后续迭代
- cache-ttl 感知的 pruning — 后续迭代
- 按 token 计费的精确 tokenizer — 粗估足够
