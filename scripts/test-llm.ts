#!/usr/bin/env npx tsx
/**
 * Quick test script for LLM integration
 *
 * Auth:
 * - Set `ANTHROPIC_API_KEY` to either:
 *   - a Claude Code setup-token from `claude setup-token` (sk-ant-oat01-...)
 *   - a standard Anthropic API key (sk-ant-api...)
 *
 * Usage:
 *   export ANTHROPIC_API_KEY='...'
 *   npx tsx scripts/test-llm.ts
 */

import { runLLM } from "../src/agent/runner.js";
import { resolveModel, validateAliases } from "../src/agent/models.js";

function redactHeaderValue(name: string, value: string): string {
  const n = name.toLowerCase();
  if (n.includes("authorization") || n.includes("api-key") || n.includes("cookie")) {
    return `REDACTED(len=${value.length})`;
  }
  return value;
}

function installFetchTracer(): void {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);

    // Avoid throwing if clone fails due to non-cloneable bodies.
    let bodyText: string | undefined;
    try {
      const clone = req.clone();
      bodyText = await clone.text();
    } catch {
      bodyText = undefined;
    }

    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = redactHeaderValue(k, v);
    });

    const maxBody = Number(process.env.OWLIABOT_TRACE_HTTP_BODY_MAX ?? "8000");
    const bodyOut =
      bodyText === undefined
        ? "(unavailable)"
        : bodyText.length > maxBody
          ? bodyText.slice(0, maxBody) + `... (truncated, ${bodyText.length} bytes)`
          : bodyText;

    console.log("\n=== HTTP Request (redacted) ===");
    console.log(`${req.method} ${req.url}`);
    console.log("Headers:", JSON.stringify(headers, null, 2));
    console.log("Body:", bodyOut);
    console.log("=== /HTTP Request ===\n");

    return originalFetch(req);
  }) as typeof fetch;
}

async function main() {
  console.log("=== OwliaBot LLM Test ===\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Missing ANTHROPIC_API_KEY.\n");
    console.log("Set it to your Anthropic credential (setup-token or API key), then re-run:");
    console.log("  export ANTHROPIC_API_KEY='...'");
    console.log("  npx tsx scripts/test-llm.ts\n");
    process.exit(2);
  }

  if (process.env.OWLIABOT_TRACE_HTTP === "1") {
    installFetchTracer();
    console.log("HTTP tracing enabled (OWLIABOT_TRACE_HTTP=1). Auth headers will be redacted.\n");
  }

  // Test 1: Validate model aliases
  console.log("1. Validating model aliases...");
  const validation = validateAliases();
  if (validation.valid) {
    console.log("   ✅ All aliases valid\n");
  } else {
    console.log("   ⚠️ Some aliases invalid:");
    validation.errors.forEach((e) => console.log(`      - ${e}`));
    console.log();
  }

  // Test 2: Resolve model
  console.log("2. Testing model resolution...");
  try {
    const model = resolveModel({ model: "claude-sonnet-4-5" });
    console.log(`   ✅ Resolved: ${model.provider}/${model.id}\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Test 3: Call LLM
  console.log("3. Testing LLM call...");
  try {
    const response = await runLLM(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      [
        { role: "system", content: "You are a helpful assistant. Be very brief.", timestamp: Date.now() },
        { role: "user", content: "Say hello in one word.", timestamp: Date.now() },
      ],
      { maxTokens: 50 }
    );

    console.log(`   ✅ Response: "${response.content}"`);
    console.log(`   📊 Usage: ${response.usage.promptTokens} in / ${response.usage.completionTokens} out`);
    console.log(`   🤖 Provider: ${response.provider}/${response.model}`);
    if (response.truncated) {
      console.log("   ⚠️ Response was truncated");
    }
    console.log();
  } catch (err) {
    console.log(`   ❌ Failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Test 4: Test with tools
  console.log("4. Testing LLM with tools...");
  try {
    const response = await runLLM(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      [
        { role: "system", content: "You are a helpful assistant.", timestamp: Date.now() },
        { role: "user", content: "What time is it? Use the get_time tool.", timestamp: Date.now() },
      ],
      {
        maxTokens: 200,
        tools: [
          {
            name: "get_time",
            description: "Get the current time",
            parameters: {
              type: "object",
              properties: {},
            },
            security: { level: "read" },
            execute: async () => ({ success: true, data: new Date().toISOString() }),
          },
        ],
      }
    );

    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(`   ✅ Tool call requested: ${response.toolCalls[0].name}`);
    } else {
      console.log(`   ⚠️ No tool call (response: "${response.content.slice(0, 50)}...")`);
    }
    console.log();
  } catch (err) {
    console.log(`   ❌ Failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  console.log("=== All tests passed! ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
