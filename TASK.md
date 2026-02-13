# Task: Fix LLM Empty Reply Bug + Add Context Compression

Read DEEP_DIVE_APOLOGIZE_BUG.md for full analysis.

## Changes Required

### 1. Fix LLM empty reply bug in `src/gateway/agentic-loop.ts`

Around line 348 where the fallback "I apologize, but I couldn't complete your request." is returned:

- Check `lastAssistant.stopReason` and `lastAssistant.errorMessage` before falling back to generic apology
- If `stopReason === "error" || "aborted"`: show the actual errorMessage to user (e.g. "⚠️ 处理失败：{errorMessage}")
- If `stopReason === "length"`: tell user context is too long, suggest /new
- Add `log.warn(...)` with structured diagnostics (stopReason, errorMessage, contentTypes) when text extraction returns empty
- Keep the generic apology as absolute last resort only

### 2. Add tool result truncation in `src/gateway/agentic-loop.ts`

Add a `truncateToolResult(content, maxChars=8192)` helper:
- If tool result text content exceeds maxChars, truncate and append `\n[... truncated, original length: N chars]`
- Apply this in the tool execution result path before passing back to context
- Make maxChars configurable or use a sensible default (8192)

### 3. Add context size logging before LLM calls

In the agentic loop, before sending messages to the LLM:
- Log `log.info({ messageCount, toolCallCount, estimatedChars })` to help debug context issues
- This can be in `transformContext` or right before the LLM call

## Rules
- Run `npx tsc --noEmit` to check types compile
- Run `npx vitest run` to make sure tests pass  
- Keep changes minimal and focused
- Write in TypeScript matching existing code style
- Do NOT modify test files unless adding new test cases for the changes
- Commit with conventional commit format: `fix: surface LLM error details instead of generic apology` for the bug fix, `feat: add tool result truncation and context size logging` for the compression

## When completely finished, run:
openclaw gateway wake --text "Done: Fixed LLM empty reply bug + added tool result truncation and context logging" --mode now
