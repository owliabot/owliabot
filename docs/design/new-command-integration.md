# /new 命令集成说明

## 概述

实现了 `/new` 和 `/reset` 命令，功能对标 OpenClaw 的 `/new`：
- 重置当前会话（rotate sessionId）
- 清除对话历史（transcript）
- 发送确认消息
- 支持 remainder（如 `/new sonnet`）
- 支持自定义 trigger（如 `/清除`）

## 文件变更

### 新增
- `src/gateway/commands.ts` — 命令拦截器
- `src/gateway/__tests__/commands.test.ts` — 10 个测试用例

### 需修改（手动集成）
`src/gateway/server.ts` 中 `handleMessage()` 函数开头加入命令拦截：

```diff
+ import { tryHandleCommand } from "./commands.js";

  async function handleMessage(
    ctx: MsgContext,
    config: Config,
    workspace: WorkspaceFiles,
    sessionStore: ReturnType<typeof createSessionStore>,
    transcripts: ReturnType<typeof createSessionTranscriptStore>,
    channels: ChannelRegistry,
    tools: ToolRegistry,
    writeGateChannels: Map<string, WriteGateChannel>,
  ): Promise<void> {
    if (!shouldHandleMessage(ctx, config)) {
      return;
    }

    const agentId = resolveAgentId({ config });
    const sessionKey = resolveSessionKey({ ctx, config });

+   // Intercept slash commands before the LLM loop
+   const cmd = await tryHandleCommand({
+     ctx,
+     sessionKey,
+     sessionStore,
+     transcripts,
+     channels,
+     resetTriggers: config.session?.resetTriggers,
+   });
+   if (cmd.handled) return;

    log.info(`Message from ${sessionKey}: ${ctx.body.slice(0, 50)}...`);
    // ... rest of handleMessage
```

### Config schema 扩展（可选）

`src/config/schema.ts` 中 `sessionSchema` 加入：

```typescript
resetTriggers: z.array(z.string()).optional(),
```

允许用户在 `config.yaml` 中自定义 trigger：

```yaml
session:
  resetTriggers: ["/new", "/reset", "/清除"]
```

## 行为

| 输入 | 行为 |
|------|------|
| `/new` | 重置会话，回复 "🆕 新会话已开启..." |
| `/reset` | 同上 |
| `/new sonnet` | 重置会话，回复 "🆕 会话已重置。继续处理：sonnet" |
| `/newbie` | **不匹配**，进入正常 LLM 流程 |
| `hello` | **不匹配**，进入正常 LLM 流程 |

## 与 OpenClaw 的对比

| 特性 | OpenClaw | owliabot |
|------|----------|----------|
| Reset triggers | `/new`, `/reset` + 可配置 | ✅ 相同 |
| 清除历史 | ✅ | ✅ |
| Remainder 传递 | ✅（作为新会话首条消息） | ✅（显示在确认消息中） |
| 模型切换 (`/new sonnet`) | ✅ | ⏳ 未来可扩展 |
| Greeting turn | ✅ | ✅ |
