# Deep Dive: "I apologize, but I couldn't complete your request." Bug

## 1. 结论先行

两次异常（`03:04:02`、`03:04:55`）都走了同一条主路径：

- 命中 `src/gateway/agentic-loop.ts:348` 的 fallback（不是 `:364`，也不是 `:578`）。
- 触发条件是：最后一条 assistant message 存在，但 `extractTextContent()` 提取到空字符串。
- 根因不是 timeout（无 `timeout` 日志），也不是 `runAgenticLoop` 抛异常（无 `Agentic loop error` 日志）。
- 更像是 **LLM/provider 返回了 stopReason=error/aborted 或无 text block 的 assistant 消息**，上层逻辑把真实错误吞掉，统一回退为 apology 文案。
- 同时存在高概率的上下文膨胀：会话在 reset 前达到 `107 messages`，且仅本会话在 03:04 前就有 `60` 次工具调用，工具结果含大量 JSON，**上下文超长是高度可疑触发因素**。

## 2. 代码路径总览（3个 fallback 点）

### A. `src/gateway/agentic-loop.ts:348`（本次命中）

```ts
const extracted =
  lastMessage && lastMessage.role === "assistant"
    ? extractTextContent(lastMessage)
    : "";

const finalContent =
  extracted.trim().length > 0
    ? extracted
    : "I apologize, but I couldn't complete your request.";
```

只要最后 assistant 没有 text block（或 text 全空），就会命中这里。

### B. `src/gateway/agentic-loop.ts:364`（未命中）

仅 `maxIterationsReached=true` 且走 `catch` 分支才会返回。
日志中没有 max-iterations 相关 warning。

### C. `src/gateway/agentic-loop.ts:578`（未命中）

这是 `runLegacyLoop()`（CLI provider fallback）的分支。
当前会话模型是 `anthropic/claude-opus-4-5`，走的是 pi-agent-core 主路径，不是 legacy。

## 3. `extractTextContent` 为什么会返回空

`src/gateway/agentic-loop.ts:461-468`:

```ts
function extractTextContent(message: AgentMessage): string {
  if (message.role !== "assistant") return "";

  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}
```

它只取 `type === "text"`。以下情况都会得到空串：

- `assistant.content=[]`
- 只有 `toolCall`
- 只有 `thinking`
- text block 全为空白

## 4. pi-agent-core / pi-ai 行为（stopReason、errorMessage、空 content）

### 4.1 stopReason 与 errorMessage 定义

`node_modules/@mariozechner/pi-ai/dist/types.d.ts:100-116`

- `StopReason = "stop" | "length" | "toolUse" | "error" | "aborted"`
- `AssistantMessage.errorMessage?: string`

### 4.2 为什么不会抛到 runAgenticLoop catch

`node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:88-93`：

- 当 `message.stopReason === "error" || "aborted"` 时，agentLoop **正常结束并返回消息**。
- 不会 throw 到 `runAgenticLoop` 的 catch。

所以 `runAgenticLoop` 看起来“成功返回”，但最后文本可能为空，继而触发 `:348` apology。

### 4.3 provider 可产生空内容 assistant

`node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js:118-134` 初始化 `output.content=[]`。

如果流式过程中未收到 text/tool/thinking block，就可能保持空 content。异常时 catch 会：

- `output.stopReason = "error" | "aborted"`（`anthropic.js:318`）
- `output.errorMessage = ...`（`anthropic.js:319`）
- 以 `error` 事件返回（`anthropic.js:320`）

这与本次“无错误日志但返回 apology”现象吻合。

## 5. 日志 980-1012 逐条分析

关键区间：`owliabot-log.txt:980-1012`

- `03:02:27` 到 `03:02:48`：最后一次工具执行是 `write_file`（`line 989`），完成于 `line 1000`。
- `03:02:56`：上一轮正常 `Final response`（总结文本）。
- `03:04:01`：用户消息 `这些文档里面没有提到吗...`。
- `03:04:02`：直接 `Final response: I apologize...`。
- `03:04:54`：用户消息 `hello`。
- `03:04:55`：再次 `Final response: I apologize...`。

观察点：

- 两次 apology 前都没有新的 `tool_execution_start/end`。
- 没有 timeout 日志（`Agentic loop timeout reached` / `Agentic loop timed out`）。
- 没有 `Agentic loop error:` 日志。

=> 两次都不是 timeout/throw，而是“成功返回了空文本 final message”路径。

## 6. 两次事件分别的精确代码路径

## 6.1 03:04:02 这次

1. `src/gateway/message-handler.ts:399-427` 调 `runAgenticLoop()`。
2. `src/gateway/agentic-loop.ts:187-195` 判定非 CLI provider，走 pi-agent-core 主路径。
3. `src/gateway/agentic-loop.ts:298` 启动 `agentLoop(...)`。
4. agentLoop 内部如果拿到 `stopReason=error/aborted`，会在 `pi-agent-core/dist/agent-loop.js:88-93` 正常 `agent_end` 返回。
5. 回到 `runAgenticLoop`：`stream.result()` 得到最后 assistant message（可能有 stopReason/errorMessage，但无 text）。
6. `extractTextContent()`（`agentic-loop.ts:461-468`）返回空串。
7. 命中 `agentic-loop.ts:348` fallback apology。
8. `message-handler.ts:439` 记录最终回复。

### 这次的触发条件

- 最后一条 assistant message 没有可提取 text（高概率是 provider error message with empty content）。

## 6.2 03:04:55 这次

路径与上面一致，仍是 `:348`。

差异在于上下文更大：03:04:02 失败后又把该轮消息写入 transcript，随后 `hello` 再次请求，仍立即失败。

### 这次的触发条件

- 同样是最后 assistant 无 text。
- 极可能受同一会话上下文问题持续影响（见第7节）。

## 7. 会话规模与“上下文溢出”判断

### 7.1 统计

- 会话 reset 后：`owliabot-log.txt:299` 新 session `aae13304-...`。
- reset 前总结时：`owliabot-log.txt:1011` 显示 `107 messages, 3 user`。
- 仅该 session 在 03:04 前的工具调用日志计数：`60` 次（按 `gateway:agentic-loop  ↳ tool(...)` 统计）。
- 大量 `web_fetch` 工具结果包含长 JSON（见 `line 933/944/955/966/988/1000`）。

### 7.2 结论

- **上下文长度问题高度可疑**（高概率）。
- 但从现有日志无法 100% 直接证明，因为当前代码没有把最后 assistant 的 `stopReason/errorMessage` 打到日志。
- 因此本问题本质是：
  - 可能先有 provider/context 错误，
  - 再被上层 `extractTextContent -> apology` 逻辑掩盖成同一条模糊文案（逻辑可观测性 bug）。

## 8. 是否是 context-length / LLM error / 逻辑 bug？

综合判断：

- **直接可确认**：逻辑 bug（错误可观测性缺失）。
  - `runAgenticLoop` 未处理 `lastAssistant.stopReason/errorMessage`，导致真实错误被 `:348` 吞掉。
- **高概率根因**：LLM provider 错误，且很可能与 context-length 膨胀相关。
- **非 timeout**：可排除（日志证据充分）。

## 9. 修复补丁（diff）

目标：

1. 不再无条件把“空文本”变成 apology。
2. 优先暴露 `stopReason/errorMessage`。
3. 对 `length` 给出明确上下文提示。
4. 记录结构化日志，后续可直接定位 provider 根因。

```diff
diff --git a/src/gateway/agentic-loop.ts b/src/gateway/agentic-loop.ts
index 8f4a0c2..c1aab4e 100644
--- a/src/gateway/agentic-loop.ts
+++ b/src/gateway/agentic-loop.ts
@@ -335,14 +335,46 @@ export async function runAgenticLoop(
     // Use result if available, fall back to collected messages
     collectedMessages = finalMessages.length > 0 ? finalMessages : collectedMessages;
 
-    // Extract final content from last assistant message
+    // Extract final content from last assistant message.
+    // NOTE: final assistant may be stopReason=error/aborted with empty content.
     const lastMessage = finalMessages[finalMessages.length - 1];
-    const extracted =
-      lastMessage && lastMessage.role === "assistant"
-        ? extractTextContent(lastMessage)
-        : "";
-    // Fallback when the LLM's last turn was tool-only (no text block)
-    const finalContent =
-      extracted.trim().length > 0
-        ? extracted
-        : "I apologize, but I couldn't complete your request.";
+    const lastAssistant =
+      lastMessage && lastMessage.role === "assistant" ? (lastMessage as any) : undefined;
+    const extracted = lastAssistant ? extractTextContent(lastAssistant) : "";
+
+    let finalContent = extracted;
+
+    if (finalContent.trim().length === 0 && lastAssistant) {
+      const stopReason = lastAssistant.stopReason as string | undefined;
+      const errorMessage =
+        typeof lastAssistant.errorMessage === "string"
+          ? lastAssistant.errorMessage.trim()
+          : "";
+
+      // Preserve real provider errors instead of masking as generic apology.
+      if (stopReason === "error" || stopReason === "aborted") {
+        finalContent = errorMessage.length > 0
+          ? `⚠️ 处理失败：${errorMessage}`
+          : "⚠️ 处理失败：上游模型返回异常。请重试。";
+      } else if (stopReason === "length") {
+        finalContent = "⚠️ 上下文过长：请先发送 /new 开启新会话，或缩短请求后重试。";
+      } else {
+        // Last assistant had no text/thinking only/tool-only. Try previous assistant text.
+        const previousText = [...finalMessages]
+          .reverse()
+          .find((m: any) => m?.role === "assistant" && extractTextContent(m).trim().length > 0);
+        finalContent = previousText
+          ? extractTextContent(previousText as any)
+          : "I apologize, but I couldn't complete your request.";
+      }
+
+      log.warn(
+        {
+          stopReason,
+          errorMessage: errorMessage || undefined,
+          contentTypes: Array.isArray(lastAssistant.content)
+            ? lastAssistant.content.map((c: any) => c?.type)
+            : [],
+        },
+        "Final assistant message had no extractable text"
+      );
+    }
 
     return {
       content: finalContent,
```

可选（进一步防止复发）：在 `transformContext` 里加上下文裁剪（按近 N turns 或 token 估算），防止 transcript 无限增长后持续触发 provider error。

---

## 10. 最终判定（针对提问点）

- 两次 03:04 的 "I apologize" 均走 `agentic-loop.ts:348`。
- 两次触发条件都是 `extractTextContent(lastAssistant) === ""`。
- `:364`（max iterations）和 `:578`（legacy loop）本次未触发。
- 无 timeout 证据、无 runAgenticLoop 抛错证据。
- 高概率是 provider 报错（很可能 context-length 相关）被上层逻辑吞掉，呈现为统一 apology。
