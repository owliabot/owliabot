# Agent Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the security gaps identified in the Agent Security review by implementing inline tier confirmations, strengthening filesystem and DLP guardrails, and improving confirmation visibility.

**Architecture:** Introduce a policy-level confirmation flow that can reuse the channel confirmation infrastructure (inline), harden file read/list deny-lists for workspace roots, enrich WriteGate confirmation summaries, and expand web.fetch secret scanning scope. Keep changes fail-closed and audited.

**Tech Stack:** TypeScript, Vitest (run via `bunx vitest run` due to `bun test` segfault), existing audit/logger + policy engine.

> Note: `bun test` currently crashes on `src/workspace/memory-search.auto-index.test.ts` (Bun segfault). Use `bunx vitest run` for test commands in this plan.

---

### Task 1: Block sensitive files in workspace read/list tools

**Files:**
- Modify: `src/agent/tools/builtin/fs-roots.ts`
- Modify: `src/agent/tools/builtin/read-file.ts`
- Modify: `src/agent/tools/builtin/list-files.ts`
- Test: `src/agent/tools/builtin/__tests__/read-file.test.ts`
- Test: `src/agent/tools/builtin/__tests__/list-files.test.ts`

**Step 1: Write failing tests for workspace sensitive file denial**

```ts
// src/agent/tools/builtin/__tests__/read-file.test.ts
it("denies reading .env in workspace root", async () => {
  const tool = createReadFileTool({ workspace: tmpDir });
  await writeFile(join(tmpDir, ".env"), "SECRET=1", "utf-8");
  const res = await tool.execute({ root: "workspace", path: ".env" } as any);
  expect(res.success).toBe(false);
  expect(res.error).toMatch(/sensitive file/i);
});
```

```ts
// src/agent/tools/builtin/__tests__/list-files.test.ts
it("filters sensitive files in workspace listings", async () => {
  const tool = createListFilesTool({ workspace: tmpDir });
  await writeFile(join(tmpDir, "secrets.yaml"), "x", "utf-8");
  const res = await tool.execute({ root: "workspace" } as any);
  expect(res.success).toBe(true);
  expect(res.data.entries.find((e: any) => e.name === "secrets.yaml")).toBeFalsy();
});
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/agent/tools/builtin/__tests__/read-file.test.ts src/agent/tools/builtin/__tests__/list-files.test.ts`
Expected: FAIL (sensitive files currently allowed in workspace).

**Step 3: Implement workspace sensitive-path detection**

```ts
// src/agent/tools/builtin/fs-roots.ts
export function isSensitiveWorkspacePath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").toLowerCase();
  if (p === "secrets.yaml" || p === "secrets.yml") return true;
  if (p === ".env" || p.startsWith(".env.")) return true;
  if (p.startsWith("auth/") || p === "auth") return true;
  const base = path.posix.basename(p);
  if (base === "id_rsa" || base === "id_ed25519") return true;
  const ext = path.posix.extname(base);
  if ([".pem", ".key", ".p12", ".pfx"].includes(ext)) return true;
  return false;
}
```

```ts
// src/agent/tools/builtin/read-file.ts
if (selectedRoot === "workspace" && isSensitiveWorkspacePath(relativePath)) {
  return { success: false, error: `Access denied: sensitive file (${basename(relativePath)})` };
}
```

```ts
// src/agent/tools/builtin/list-files.ts
if (selectedRoot === "workspace" && isSensitiveWorkspacePath(entryRel)) {
  continue;
}
```

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/agent/tools/builtin/__tests__/read-file.test.ts src/agent/tools/builtin/__tests__/list-files.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agent/tools/builtin/fs-roots.ts src/agent/tools/builtin/read-file.ts src/agent/tools/builtin/list-files.ts src/agent/tools/builtin/__tests__/read-file.test.ts src/agent/tools/builtin/__tests__/list-files.test.ts
git commit -m "security: block sensitive workspace files in fs tools"
```

---

### Task 2: Enrich WriteGate confirmation summaries with high-risk details

**Files:**
- Modify: `src/security/write-gate.ts`
- Test: `src/security/write-gate.test.ts`

**Step 1: Write failing tests for wallet/mcp confirmation details**

```ts
// src/security/write-gate.test.ts
it("includes wallet_transfer details in confirmation message", () => {
  const gate = createWriteGate({ writeToolAllowList: ["u"], writeToolConfirmation: true }, mockChannel, "/tmp");
  const msg = (gate as any).buildConfirmationMessage({
    name: "wallet_transfer",
    arguments: { to: "0xabc", amount: "1.23", token: "ETH", chain_id: 8453 },
  });
  expect(msg).toContain("0xabc");
  expect(msg).toContain("1.23");
  expect(msg).toContain("ETH");
  expect(msg).toContain("8453");
});

it("includes mcp_manage details in confirmation message", () => {
  const msg = (gate as any).buildConfirmationMessage({
    name: "mcp_manage",
    arguments: { action: "add", command: "npx", args: ["@playwright/mcp"], transport: "stdio" },
  });
  expect(msg).toContain("mcp_manage");
  expect(msg).toContain("add");
  expect(msg).toContain("npx");
});
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/security/write-gate.test.ts`
Expected: FAIL (confirmation message lacks these fields).

**Step 3: Implement tool-specific message enrichment**

```ts
// src/security/write-gate.ts (inside buildConfirmationMessage)
if (call.name === "wallet_transfer") {
  addLine("**To:**", params.to);
  addLine("**Amount:**", params.amount);
  addLine("**Token:**", params.token);
  addLine("**Chain ID:**", params.chain_id);
}
if (call.name === "mcp_manage") {
  addLine("**Action:**", params.action);
  addLine("**Command:**", params.command);
  addLine("**Args:**", Array.isArray(params.args) ? params.args.join(" ") : undefined);
  addLine("**Transport:**", params.transport);
  addLine("**URL:**", params.url);
  addLine("**CWD:**", params.cwd);
}
```

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/security/write-gate.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/security/write-gate.ts src/security/write-gate.test.ts
git commit -m "security: include high-risk details in writegate confirmations"
```

---

### Task 3: Implement policy-level inline confirmations (Tier 1/2)

**Files:**
- Create: `src/security/policy-confirmation.ts`
- Modify: `src/agent/tools/executor.ts`
- Modify: `src/audit/logger.ts`
- Test: `src/security/__tests__/policy-confirmation.test.ts`
- Test: `src/agent/tools/__tests__/executor.test.ts`

**Step 1: Write failing tests for inline confirmations**

```ts
// src/security/__tests__/policy-confirmation.test.ts
it("approves on yes and denies on no/timeout", async () => {
  const confirm = createPolicyConfirmation(mockChannel);
  expect(await confirm.request({ tool: "wallet_transfer", tier: 2 })).toEqual({ approved: true });
  expect(await confirm.request({ tool: "wallet_transfer", tier: 2, mockReply: "no" })).toEqual({ approved: false });
});
```

```ts
// src/agent/tools/__tests__/executor.test.ts
it("requires inline confirmation for tier confirm", async () => {
  const res = await executeToolCall(call, {
    ...opts,
    policyEngine: engineReturningConfirm,
    confirmationChannel: mockChannel,
  });
  expect(res.success).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/security/__tests__/policy-confirmation.test.ts src/agent/tools/__tests__/executor.test.ts`
Expected: FAIL (confirmation flow not implemented).

**Step 3: Add inline policy confirmation helper**

```ts
// src/security/policy-confirmation.ts
export function createPolicyConfirmation(channel: WriteGateChannel) {
  return {
    async request(req: { tool: string; tier: number | "none"; reason?: string }) {
      // send message + await yes/no reply; return { approved, reason }
    },
  };
}
```

**Step 4: Wire confirmation into executor**

```ts
// src/agent/tools/executor.ts
if (decision.action === "confirm") {
  if (decision.confirmationChannel === "inline" && options.confirmationChannel) {
    const confirm = createPolicyConfirmation(options.confirmationChannel);
    const verdict = await confirm.request({ tool: call.name, tier: decision.effectiveTier, reason: decision.reason });
    if (!verdict.approved) { /* finalize audit as denied + return */ }
  } else {
    // fail closed for companion-app until implemented
    /* finalize audit + return explicit error */
  }
}
```

**Step 5: Extend audit finalize with confirmation metadata**

```ts
// src/audit/logger.ts
await auditLogger.finalize(id, "success", undefined, {
  confirmation: { required: true, channel: "inline", respondedAt: new Date().toISOString(), approved: true }
});
```

**Step 6: Run tests to verify they pass**

Run: `bunx vitest run src/security/__tests__/policy-confirmation.test.ts src/agent/tools/__tests__/executor.test.ts`
Expected: PASS.

**Step 7: Commit**

```bash
git add src/security/policy-confirmation.ts src/agent/tools/executor.ts src/audit/logger.ts src/security/__tests__/policy-confirmation.test.ts src/agent/tools/__tests__/executor.test.ts
git commit -m "security: add inline tier confirmations"
```

---

### Task 4: Expand web.fetch secret scanning scope

**Files:**
- Modify: `src/system/security/secret-scanner.ts`
- Modify: `src/system/actions/web-fetch.ts`
- Test: `src/system/__tests__/secret-scanner.test.ts`
- Test: `src/system/__tests__/web-fetch.test.ts`

**Step 1: Write failing tests for headers/query scanning + mnemonic detection**

```ts
// src/system/__tests__/secret-scanner.test.ts
it("detects mnemonic-like phrases", () => {
  const body = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const res = scanForSecrets(body);
  expect(res.hasHighConfidence).toBe(true);
});
```

```ts
// src/system/__tests__/web-fetch.test.ts
it("blocks when headers contain secrets", async () => {
  await expect(webFetchAction({ url: "https://example.com", method: "POST", headers: { Authorization: "Bearer sk-test-12345678901234567890" }, body: "x" }, ctx, cfg))
    .rejects.toThrow(/blocked/i);
});
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/system/__tests__/secret-scanner.test.ts src/system/__tests__/web-fetch.test.ts`
Expected: FAIL.

**Step 3: Implement scanning for headers/query and mnemonic heuristic**

```ts
// src/system/security/secret-scanner.ts
const MNEMONIC_RE = /\b(?:[a-z]{3,})\b(?:\s+\b[a-z]{3,}\b){11,23}/i;
// treat mnemonic matches as high severity
```

```ts
// src/system/actions/web-fetch.ts
const targetText = [args.url, JSON.stringify(args.headers ?? {}), args.body ?? ""].join("\n");
const scan = scanForSecrets(targetText);
```

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/system/__tests__/secret-scanner.test.ts src/system/__tests__/web-fetch.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/system/security/secret-scanner.ts src/system/actions/web-fetch.ts src/system/__tests__/secret-scanner.test.ts src/system/__tests__/web-fetch.test.ts
git commit -m "security: broaden web.fetch secret scanning"
```

---

### Task 5: Update documentation to reflect enforced behaviors and new confirmations

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/design/tier-policy.md`
- Modify: `docs/design/audit-strategy.md`

**Step 1: Write doc changes in README**

Include:
- Inline confirmation flow for Tier 2 (and explicit note for Tier 1 companion-app pending).
- Sensitive file denial in workspace.
- web.fetch secret scanning scope (body + headers + URL).
- Note about cooldown limits and persistence (if still in-memory, say so).

**Step 2: Run doc lint (if any)**

Run: `bunx vitest run` (skip if no doc lint).
Expected: PASS.

**Step 3: Commit**

```bash
git add README.md README.zh-CN.md docs/design/tier-policy.md docs/design/audit-strategy.md
git commit -m "docs: document security hardening behaviors"
```
