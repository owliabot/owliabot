# Agent Runner Integration Guide

This document describes how to integrate CLI backend support into OwliaBot's agent runner.

## Overview

The integration requires modifying the agent runner to:
1. Disable the tool loop for CLI providers (tools are handled internally by the CLI)
2. Detect when a CLI provider is being used
3. Route requests to the CLI runner instead of the API-based runner
4. Handle CLI-specific session management

## Changes to `src/agent/runner.ts`

### 1. Add Imports

Add at the top of the file:

```typescript
import { isCliProvider, parseCliModelString } from "./cli/cli-provider.js";
import { runCliAgent, type CliAgentResult } from "./cli/cli-runner.js";
```

### 2. Modify the Main Entry Point

In your main agent function (likely `runAgent` or similar), add a check before the existing LLM call:

```typescript
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { provider, model, messages, config, sessionId, workdir } = options;
  
  // Check if this is a CLI provider
  const cliModel = parseCliModelString(model);
  const effectiveProvider = cliModel?.provider ?? provider;
  const effectiveModel = cliModel?.model ?? model;
  
  if (isCliProvider(effectiveProvider, config)) {
    return runCliAgentWrapper(options, effectiveProvider, effectiveModel);
  }
  
  // Existing API-based logic...
  return runApiAgent(options);
}
```

### 3. Add CLI Agent Wrapper

Add a wrapper function that adapts the CLI runner to your existing interface:

```typescript
async function runCliAgentWrapper(
  options: AgentOptions,
  provider: string,
  model: string
): Promise<AgentResult> {
  const { messages, config, sessionId, workdir } = options;
  
  // Extract the latest user message as the prompt
  const userMessages = messages.filter(m => m.role === "user");
  const latestMessage = userMessages[userMessages.length - 1];
  if (!latestMessage) {
    throw new Error("No user message found for CLI agent");
  }
  
  // Build system prompt from system messages and workspace context
  const systemMessages = messages.filter(m => m.role === "system");
  const systemPrompt = systemMessages.map(m => m.content).join("\n\n");
  
  // Determine if this is a new session
  const isFirstMessage = !sessionId || sessionId === "";
  
  // Run the CLI agent
  const result = await runCliAgent({
    provider,
    model,
    prompt: latestMessage.content,
    systemPrompt: systemPrompt || undefined,
    sessionId,
    isFirstMessage,
    workdir: workdir ?? config?.workspace ?? process.cwd(),
    timeoutMs: 120_000,
    config,
  });
  
  // Convert CLI result to standard agent result
  return {
    content: result.text,
    toolCalls: undefined,  // CLI handles tools internally
    usage: {
      promptTokens: 0,     // CLI doesn't report usage
      completionTokens: 0,
    },
    provider,
    model,
    sessionId: result.sessionId,
    // Flag to indicate tool loop should be skipped
    skipToolLoop: true,
  };
}
```

### 4. Modify Tool Loop Logic

In your tool execution loop, check for `skipToolLoop`:

```typescript
// In your main agent loop
async function handleToolLoop(response: AgentResult, options: AgentOptions): Promise<AgentResult> {
  // CLI providers handle tools internally
  if (response.skipToolLoop) {
    return response;
  }
  
  // Existing tool loop logic...
  if (!response.toolCalls || response.toolCalls.length === 0) {
    return response;
  }
  
  // ... execute tools and continue loop
}
```

### 5. Session Continuity

For CLI providers, track the session ID separately:

```typescript
// Store CLI session IDs mapped to your internal session keys
const cliSessionMap = new Map<string, string>();

function getCliSessionId(internalKey: string): string | undefined {
  return cliSessionMap.get(internalKey);
}

function setCliSessionId(internalKey: string, cliSessionId: string): void {
  cliSessionMap.set(internalKey, cliSessionId);
}
```

Update the wrapper to use this:

```typescript
async function runCliAgentWrapper(/*...*/) {
  // Get existing CLI session if any
  const existingSessionId = getCliSessionId(options.sessionKey);
  
  const result = await runCliAgent({
    // ...
    sessionId: existingSessionId,
    // ...
  });
  
  // Store the CLI session ID for future messages
  if (result.sessionId) {
    setCliSessionId(options.sessionKey, result.sessionId);
  }
  
  return { /* ... */ };
}
```

## Integration Points

### Model Resolution

Update `src/agent/models.ts` to handle CLI providers:

```typescript
export function resolveModel(config: ModelConfig): Model<Api> | null {
  // Check for CLI provider first
  if (isCliModelString(config.model)) {
    // Return null to indicate CLI provider (no pi-ai model needed)
    return null;
  }
  
  // Existing resolution logic...
}
```

### Provider Selection

When selecting a provider from the config, recognize CLI providers:

```typescript
function selectProvider(providers: ProviderConfig[], config: Config): ProviderConfig {
  for (const provider of providers.sort((a, b) => a.priority - b.priority)) {
    if (isCliProvider(provider.id, config)) {
      // CLI provider - check if command is available
      if (await isCliCommandAvailable(resolveCliBackendConfig(provider.id, config).command)) {
        return provider;
      }
      continue;
    }
    
    // API provider - check if API key is available
    if (provider.apiKey) {
      return provider;
    }
  }
  
  throw new Error("No available provider found");
}
```

## Testing

Add integration tests to verify:

1. **Provider Detection**: CLI providers are correctly identified
2. **Routing**: Requests are routed to CLI runner, not API runner
3. **Session Continuity**: Session IDs are preserved across messages
4. **Tool Skipping**: Tool loop is skipped for CLI providers
5. **Error Handling**: CLI errors are properly propagated

Example test:

```typescript
describe("Agent with CLI provider", () => {
  it("should route to CLI runner for claude-cli provider", async () => {
    const result = await runAgent({
      provider: "claude-cli",
      model: "opus",
      messages: [
        { role: "user", content: "Hello" }
      ],
      config: testConfig,
    });
    
    expect(result.provider).toBe("claude-cli");
    expect(result.skipToolLoop).toBe(true);
  });
});
```

## File Structure After Integration

```
src/agent/
├── cli/
│   ├── index.ts           # Re-exports all CLI modules
│   ├── cli-backends.ts
│   ├── cli-provider.ts
│   ├── cli-runner.ts
│   ├── cli-schema.ts
│   └── cli-runner.test.ts
├── runner.ts              # Modified to use CLI runner
├── models.ts              # Modified for CLI model handling
├── session.ts
├── session-key.ts
└── ...
```

## Notes

1. **No Streaming**: CLI output is collected in full before returning. Streaming support would require a more complex implementation.

2. **Tool Handling**: Claude CLI handles tools internally via `--dangerously-skip-permissions`. The agent should not attempt to execute tools returned by CLI providers.

3. **Timeout**: The default timeout is 120 seconds. For long-running operations, consider increasing this.

4. **Serialization**: CLI calls are serialized by default to prevent concurrent executions. This is important for the claude CLI which doesn't handle concurrent sessions well.

5. **Environment**: Sensitive API keys are cleared from the CLI process environment to prevent conflicts with the CLI's own authentication.
