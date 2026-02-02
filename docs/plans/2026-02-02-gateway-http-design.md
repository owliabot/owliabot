# Gateway HTTP v1 Design

**Status:** Approved
**Date:** 2026-02-02

## Goals
- Deliver HTTP-only Gateway v1 as an independent entrypoint.
- Provide unified auth, audit, idempotency, rate limiting, and routing.
- Keep implementation local-first with minimal dependencies.

## Key Decisions
- **Server:** `node:http` (no framework).
- **Client fetch:** native `fetch` (undici).
- **State store:** SQLite.
- **Entry:** separate script (e.g. `src/gateway-http.ts` + `npm run gateway`).
- **Pairing security:** IP allowlist + `X-Gateway-Token`.
- **Config source:** `config.yaml` (no env override for allowlist).

## API Surface (v1)
- `GET /health` (no auth, light audit)
- `GET /status` (paired device or gateway token)
- `GET /events/poll?since=<cursor>`
- `POST /command/agent`
- `POST /command/tool`
- `POST /command/system`
- `POST /command/mcp`
- `GET /pairing/pending` (allowlist + gateway token)
- `POST /pairing/approve` (allowlist + gateway token)
- `POST /pairing/revoke` (allowlist + gateway token)

All command endpoints require `X-Device-Id` + `X-Device-Token` and, if configured, `X-Gateway-Token`. Side-effect requests require `Idempotency-Key`.

## Request/Response
- Uniform request body for `/command/*` with `actor`, `sessionKey`, `payload`, `security`, `trace` fields.
- Uniform error response: `{ ok:false, traceId, error:{ code, message } }`.
- Error codes: `ERR_AUTH_REQUIRED`, `ERR_INVALID_TOKEN`, `ERR_PERMISSION_DENIED`, `ERR_IDEMPOTENCY_CONFLICT`, `ERR_RATE_LIMITED`, `ERR_INVALID_REQUEST`, `ERR_NOT_IMPLEMENTED`.

## Storage Model (SQLite)
Tables: `devices`, `pairing_pending`, `idempotency`, `events`, `audit_logs`, `rate_limits` (and optional `sessions`). Tokens are stored as hashes only. TTL cleanup runs periodically for `idempotency` and `events`.

## Routing & Execution
- Middleware chain: JSON parse → allowlist → auth → idempotency → rate limit → route.
- `/command/tool` uses existing `ToolRegistry` + `executeToolCalls`.
- `/command/agent`, `/command/system`, `/command/mcp` route via adapters; if no adapter exists, return `ERR_NOT_IMPLEMENTED` and audit.

## Observability
- Every request writes `audit_logs`.
- `/events/poll` reads from `events` with cursor semantics and TTL filtering.

## Testing
- Unit tests: allowlist parsing, token checks, idempotency conflict, rate limits, cursor handling.
- Integration tests: HTTP endpoints with temporary SQLite DB.
- E2E smoke: pair → approve → tool call → verify audit + event written.
