# Doctor Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive `owliabot doctor` command that diagnoses startup failures (especially config errors + malformed tokens/API keys) and offers safe repair actions (backup+reset config; re-set/delete bad credentials). Must run in both npm and Docker deployments.

**Architecture:** Implement a small `src/doctor` module with pure, testable functions to (1) diagnose config/secrets/credential issues and (2) apply safe fixes (backup/reset config; write to `secrets.yaml`). Wire it into `src/entry.ts` as a Commander subcommand that prints findings and drives interactive remediation using existing readline helpers from `src/onboarding/shared.ts`.

**Tech Stack:** Node.js (>=22), TypeScript, `commander`, `yaml`, `zod`, `fs/promises`.

---

### Task 1: CLI Surface (doctor command exists)

**Files:**
- Modify: `src/__tests__/entry.test.ts`
- Modify: `src/entry.ts`

**Step 1: Write the failing test**

Update `src/__tests__/entry.test.ts` to assert `src/entry.ts` contains `.command("doctor")`.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/entry.test.ts`
Expected: FAIL, missing `.command("doctor")`.

**Step 3: Write minimal implementation**

Add a `doctor` command stub in `src/entry.ts`:
- Options: `-c, --config <path>` defaulting to `process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath()`
- Action: print a short message and exit 0 (temporary)

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/entry.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/__tests__/entry.test.ts src/entry.ts
git commit -m "feat(cli): add doctor command stub"
```

---

### Task 2: Doctor Module (diagnose + safe fixes)

**Files:**
- Create: `src/doctor/index.ts`
- Create: `src/doctor/__tests__/doctor.test.ts`

**Step 1: Write the failing test**

Create `src/doctor/__tests__/doctor.test.ts` covering:
- missing config file -> `config.missing` error
- YAML parse error -> `config.parse_error` error
- invalid Telegram token in `secrets.yaml` -> `credential.telegram.token.invalid_format` error + `deleteChannelToken()` removes it
- `setChannelToken()` stores token in `secrets.yaml` and removes inline config token
- `resetConfigFile()` backs up config and writes a schema-valid minimal config

**Step 2: Run test to verify it fails**

Run: `npm test -- src/doctor/__tests__/doctor.test.ts`
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

Implement `src/doctor/index.ts`:
- `diagnoseDoctor({ configPath, env? }) -> DoctorReport`
- `resetConfigFile({ configPath, backup?, now? })`
- `setChannelToken({ configPath, channel, token })`
- `deleteChannelToken({ configPath, channel })`

Notes:
- Parse YAML with `yaml.parse`
- Validate config with `configSchema` (after `${VARS}` expansion) to catch schema errors early
- Resolve `secrets.yaml` next to the config
- Token format checks (minimum viable):
  - Telegram: `/^\\d+:[A-Za-z0-9_-]{20,}$/`
  - (Optional later) Discord/OpenAI/Anthropic patterns
- Fix actions must be atomic (write to temp then rename)
- Backups should be timestamped: `app.yaml.bak.<utc-compact>`

**Step 4: Run test to verify it passes**

Run: `npm test -- src/doctor/__tests__/doctor.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/doctor/index.ts src/doctor/__tests__/doctor.test.ts
git commit -m "feat(doctor): add diagnostics and safe config/token fixes"
```

---

### Task 3: Interactive Doctor Flow (default interactive)

**Files:**
- Modify: `src/entry.ts`
- Modify: `src/onboarding/shared.ts` (only if missing a helper; prefer reuse)

**Step 1: Write the failing test**

Keep scope small: the existing `src/__tests__/entry.test.ts` assertion is sufficient for CLI surface.
(Optional) Add a unit test for the action handler by extracting it to a pure function and mocking readline.

**Step 2: Run tests to verify current behavior**

Run:
- `npm test -- src/__tests__/entry.test.ts`
- `npm test -- src/doctor/__tests__/doctor.test.ts`
Expected: PASS.

**Step 3: Implement interactive behavior**

In `src/entry.ts` `doctor` action:
- Call `diagnoseDoctor()` and print issues.
- If `report.ok`, print "No issues found" and exit 0.
- Otherwise, prompt:
  - If config/secrets parse/validation errors exist: offer "backup + reset config" (calls `resetConfigFile({ backup: true })`)
  - If credential format errors exist: offer per-credential actions:
    - "set new value" (prompt secret input, call `setChannelToken`)
    - "delete value" (call `deleteChannelToken`)
- Re-run `diagnoseDoctor()` after applying a fix and print updated status.

**Step 4: Run tests**

Run: `npm test`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/entry.ts src/onboarding/shared.ts
git commit -m "feat(cli): interactive doctor remediation flow"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.zh-CN.md` (and optionally `README.md`)
- Modify: `docs/setup-verify.md`

**Step 1: Update docs**

Add a short section:
- How to run: `owliabot doctor` (local) / `docker exec -it owliabot owliabot doctor` (docker)
- What it checks (config parse/validation; token/apiKey format)
- What it can fix (backup+reset config; set/delete bad credentials)

**Step 2: Verify**

Run: `npm test`
Expected: PASS.

**Step 3: Commit**

```bash
git add README.zh-CN.md docs/setup-verify.md
git commit -m "docs: document doctor command"
```

---

### Task 5: Final Verification + PR

**Step 1: Full verification**

Run:
```bash
npm test
npm run typecheck
```
Expected: PASS.

**Step 2: Push + PR**

Push the branch and create a PR with base `origin/develop`.

