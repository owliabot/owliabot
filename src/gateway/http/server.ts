/**
 * Gateway HTTP Server
 *
 * Phase 2 of Gateway Unification: HTTP API as a Channel Adapter.
 * Requires shared resources from main gateway (no fallback/standalone mode).
 *
 * Route organization:
 * - /health — no auth
 * - /status — gateway token
 * - /pair/request, /pair/status — device auth
 * - /command/tool, /command/system — device token + scope check
 * - /events/poll — device token, ACK mechanism
 * - /mcp — device token + scope check (stub)
 * - /admin/* — gateway token (devices, approve, reject, revoke, scope, token rotate)
 *
 * @see docs/plans/gateway-unification.md Phase 2
 */

import http from "node:http";
import { Readable, Writable } from "node:stream";
import { createStore, type Store, type ApiKeyRecord } from "./store.js";
import { executeToolCalls } from "../../agent/tools/executor.js";
import { createNoopAuditLogger } from "./noop-audit.js";
import type { ToolCall, ToolResult } from "../../agent/tools/interface.js";
import type { ToolRegistry } from "../../agent/tools/registry.js";
import type { SessionStore } from "../../agent/session-store.js";
import type { SessionTranscriptStore } from "../../agent/session-transcript.js";
import { hashRequest, hashToken, isIpAllowed } from "./utils.js";
import { executeSystemRequest } from "../../system/executor.js";
import type { SystemCapabilityConfig } from "../../system/interface.js";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import {
  checkToolScope,
  checkSystemScope,
  checkMcpScope,
  DeviceScopeSchema,
  DEFAULT_SCOPE,
  type DeviceScope,
} from "./scope.js";
import { createHttpChannel } from "./channel.js";
import type { ChannelPlugin } from "../../channels/interface.js";

export interface GatewayHttpConfig {
  enabled?: boolean;
  host: string;
  port: number;
  token?: string;
  allowlist: string[];
  sqlitePath: string;
  idempotencyTtlMs: number;
  eventTtlMs: number;
  rateLimit: { windowMs: number; max: number };
  /** Maximum events per device before dropping oldest (default: 1000) */
  /** TODO: Currently unused — wire into pollEventsForDevice or remove in next cleanup pass */
  maxEventsPerDevice?: number;
  /** Events per poll batch (default: 100) */
  pollBatchSize?: number;
}

export interface GatewayHttpOptions {
  config: GatewayHttpConfig;
  /** Shared tool registry from main gateway (REQUIRED) */
  toolRegistry: ToolRegistry;
  /** Shared session store from main gateway (REQUIRED) */
  sessionStore: SessionStore;
  /** Shared transcript store from main gateway (REQUIRED) */
  transcripts: SessionTranscriptStore;
  workspacePath: string;
  system?: SystemCapabilityConfig;
  /** Optional fetch injection for tests (defaults to global fetch) */
  fetchImpl?: typeof fetch;
}

export interface GatewayHttpResult {
  baseUrl: string;
  stop: () => Promise<void>;
  store: Store;
  channel: ChannelPlugin;
  /**
   * In-process request helper for environments that can't bind to network ports.
   * Acts like a minimal `fetch()` against this server instance.
   */
  request: (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string; remoteIp?: string }) => Promise<Response>;
}

/**
 * Start the Gateway HTTP server.
 *
 * Phase 2 of Gateway Unification: requires shared resources from main gateway.
 * No fallback to standalone mode - main gateway must provide all dependencies.
 *
 * @see docs/plans/gateway-unification.md
 */
export async function startGatewayHttp(opts: GatewayHttpOptions): Promise<GatewayHttpResult> {
  const { config, toolRegistry: tools, workspacePath } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Ensure sqlite parent dir exists (better-sqlite3 won't create it).
  const dbDir = dirname(config.sqlitePath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const store = createStore(config.sqlitePath);
  const pollBatchSize = config.pollBatchSize ?? 100;

  // Create HTTP channel plugin for message delivery
  const httpChannel = createHttpChannel({ store });

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const remoteIp = getRemoteIp(req);

    // Opportunistic cleanup to keep sqlite tables bounded
    store.cleanup(Date.now());

    // IP allowlist check
    if (
      config.allowlist.length > 0 &&
      !isIpAllowed(remoteIp, config.allowlist)
    ) {
      sendJson(res, 403, {
        ok: false,
        error: { code: "ERR_FORBIDDEN", message: "IP not allowed" },
      });
      return;
    }

    // =========================================================================
    // PUBLIC ROUTES (no auth)
    // =========================================================================

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: true, version: "0.2.0", uptime: process.uptime() })
      );
      return;
    }

    // =========================================================================
    // GATEWAY TOKEN ROUTES
    // =========================================================================

    if (url.pathname === "/status" && req.method === "GET") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const pending = store.listPending();
      const devices = store.listDevices().map((d) => ({
        deviceId: d.deviceId,
        scope: d.scope,
        revokedAt: d.revokedAt,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
      }));
      sendJson(res, 200, {
        ok: true,
        data: { devices, pending },
      });
      return;
    }

    // =========================================================================
    // ADMIN ROUTES (gateway token)
    // =========================================================================

    if (url.pathname === "/admin/devices" && req.method === "GET") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const devices = store.listDevices().map((d) => ({
        deviceId: d.deviceId,
        scope: d.scope,
        revokedAt: d.revokedAt,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
      }));
      sendJson(res, 200, { ok: true, data: { devices } });
      return;
    }

    if (url.pathname === "/admin/pending" && req.method === "GET") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const pending = store.listPending();
      sendJson(res, 200, { ok: true, data: { pending } });
      return;
    }

    if (url.pathname === "/admin/approve" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      // Parse scope from request, falling back to default
      let scope: DeviceScope = DEFAULT_SCOPE;
      if (body?.scope) {
        try {
          scope = DeviceScopeSchema.parse(body.scope);
        } catch {
          sendJson(res, 400, {
            ok: false,
            error: { code: "ERR_INVALID_REQUEST", message: "Invalid scope format" },
          });
          return;
        }
      }
      const deviceToken = store.approveDevice(deviceId, scope);
      sendJson(res, 200, {
        ok: true,
        data: { deviceId, deviceToken, scope },
      });
      return;
    }

    if (url.pathname === "/admin/reject" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      store.removePending(deviceId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/admin/revoke" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      store.revokeDevice(deviceId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/admin/scope" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      let scope: DeviceScope;
      try {
        scope = DeviceScopeSchema.parse(body?.scope);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid scope format" },
        });
        return;
      }
      const updated = store.updateScope(deviceId, scope);
      if (!updated) {
        sendJson(res, 404, {
          ok: false,
          error: { code: "ERR_NOT_FOUND", message: "Device not found or revoked" },
        });
        return;
      }
      sendJson(res, 200, { ok: true, data: { deviceId, scope } });
      return;
    }

    if (url.pathname === "/admin/rotate-token" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      const newToken = store.rotateToken(deviceId);
      if (!newToken) {
        sendJson(res, 404, {
          ok: false,
          error: { code: "ERR_NOT_FOUND", message: "Device not found or revoked" },
        });
        return;
      }
      sendJson(res, 200, { ok: true, data: { deviceId, deviceToken: newToken } });
      return;
    }

    // =========================================================================
    // ADMIN API KEY ROUTES (gateway token)
    // =========================================================================

    if (url.pathname === "/admin/api-keys" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const name = body?.name;
      if (typeof name !== "string" || name.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "name required" },
        });
        return;
      }
      let scope: DeviceScope = DEFAULT_SCOPE;
      if (body?.scope) {
        try {
          scope = DeviceScopeSchema.parse(body.scope);
        } catch {
          sendJson(res, 400, {
            ok: false,
            error: { code: "ERR_INVALID_REQUEST", message: "Invalid scope format" },
          });
          return;
        }
      }
      const expiresAt = typeof body?.expiresAt === "number" ? body.expiresAt : undefined;
      const result = store.createApiKey(name, scope, expiresAt);
      sendJson(res, 200, {
        ok: true,
        data: { id: result.id, key: result.key, scope, expiresAt: expiresAt ?? null },
      });
      return;
    }

    if (url.pathname === "/admin/api-keys" && req.method === "GET") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const keys = store.listApiKeys();
      sendJson(res, 200, {
        ok: true,
        data: {
          keys: keys.map((k) => ({
            id: k.id,
            name: k.name,
            scope: k.scope,
            createdAt: k.createdAt,
            expiresAt: k.expiresAt,
            revokedAt: k.revokedAt,
            lastUsedAt: k.lastUsedAt,
          })),
        },
      });
      return;
    }

    if (url.pathname.startsWith("/admin/api-keys/") && req.method === "DELETE") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const id = url.pathname.slice("/admin/api-keys/".length);
      if (!id) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Key ID required" },
        });
        return;
      }
      const revoked = store.revokeApiKey(id);
      if (!revoked) {
        sendJson(res, 404, {
          ok: false,
          error: { code: "ERR_NOT_FOUND", message: "API key not found or already revoked" },
        });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // =========================================================================
    // PAIRING ROUTES (device auth)
    // =========================================================================

    // Legacy route for backward compatibility
    if (url.pathname === "/pairing/pending" && req.method === "GET") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const pending = store.listPending();
      sendJson(res, 200, { ok: true, data: { pending } });
      return;
    }

    if (url.pathname === "/pair/request" && req.method === "POST") {
      const deviceId = getHeader(req, "x-device-id");
      if (!deviceId) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Missing X-Device-Id" },
        });
        return;
      }
      const userAgent = String(req.headers["user-agent"] ?? "");
      store.addPending(deviceId, remoteIp, userAgent);
      sendJson(res, 200, { ok: true, data: { deviceId, status: "pending" } });
      return;
    }

    // Legacy route for backward compatibility
    if (url.pathname === "/pairing/request" && req.method === "POST") {
      const deviceId = getHeader(req, "x-device-id");
      if (!deviceId) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Missing X-Device-Id" },
        });
        return;
      }
      const userAgent = String(req.headers["user-agent"] ?? "");
      store.addPending(deviceId, remoteIp, userAgent);
      sendJson(res, 200, { ok: true, data: { deviceId, status: "pending" } });
      return;
    }

    if (url.pathname === "/pair/status" && req.method === "GET") {
      const deviceId = getHeader(req, "x-device-id");
      const deviceToken = getHeader(req, "x-device-token");
      if (!deviceId) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Missing X-Device-Id" },
        });
        return;
      }
      const device = store.getDevice(deviceId);
      if (!device) {
        // Check if pending
        const pending = store.listPending().find((p) => p.deviceId === deviceId);
        if (pending) {
          sendJson(res, 200, { ok: true, data: { status: "pending" } });
        } else {
          sendJson(res, 200, { ok: true, data: { status: "unknown" } });
        }
        return;
      }
      if (device.revokedAt) {
        sendJson(res, 200, { ok: true, data: { status: "revoked" } });
        return;
      }
      if (deviceToken && hashToken(deviceToken) === device.tokenHash) {
        sendJson(res, 200, {
          ok: true,
          data: { status: "paired", scope: device.scope },
        });
      } else {
        sendJson(res, 200, { ok: true, data: { status: "paired" } });
      }
      return;
    }

    // Legacy route for backward compatibility
    if (url.pathname === "/pairing/approve" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      let scope: DeviceScope = DEFAULT_SCOPE;
      if (body?.scope) {
        try {
          scope = DeviceScopeSchema.parse(body.scope);
        } catch {
          sendJson(res, 400, {
            ok: false,
            error: { code: "ERR_INVALID_REQUEST", message: "Invalid scope format" },
          });
          return;
        }
      }
      const deviceToken = store.approveDevice(deviceId, scope);
      sendJson(res, 200, {
        ok: true,
        data: { deviceId, deviceToken, scope },
      });
      return;
    }

    // Legacy route for backward compatibility
    if (url.pathname === "/pairing/revoke" && req.method === "POST") {
      if (!requireGatewayAuth(req, config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      store.revokeDevice(deviceId);
      sendJson(res, 200, { ok: true });
      return;
    }

    // =========================================================================
    // DEVICE ROUTES (device token + scope check)
    // =========================================================================

    if (url.pathname === "/events/poll" && req.method === "GET") {
      const authResult = await requireDeviceAuth(req, store, remoteIp);
      if (!authResult.ok) {
        sendJson(res, authResult.status, authResult.error);
        return;
      }
      const { device } = authResult;

      // ACK mechanism: acknowledge events up to this ID
      const ackParam = url.searchParams.get("ack");
      if (ackParam) {
        const ackId = Number(ackParam);
        if (Number.isFinite(ackId) && ackId > 0) {
          store.ackEvents(device.deviceId, ackId, Date.now());
        }
      }

      const sinceParam = url.searchParams.get("since");
      const since = sinceParam ? Number(sinceParam) : null;
      const now = Date.now();

      const { cursor, events, dropped } = store.pollEventsForDevice(
        device.deviceId,
        Number.isFinite(since) ? since : null,
        pollBatchSize,
        now
      );

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (dropped > 0) {
        headers["X-Events-Dropped"] = String(dropped);
      }

      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, cursor, events }));
      return;
    }

    if (url.pathname === "/command/tool" && req.method === "POST") {
      const authResult = await requireDeviceAuth(req, store, remoteIp);
      if (!authResult.ok) {
        sendJson(res, authResult.status, authResult.error);
        return;
      }
      const { device } = authResult;

      let rawBody = "";
      let body: any;
      try {
        rawBody = await readBodyString(req);
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const calls = body?.payload?.toolCalls;
      if (!Array.isArray(calls)) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "toolCalls required" },
        });
        return;
      }

      const toolCalls: ToolCall[] = calls.map((call: any) => ({
        id: String(call.id),
        name: String(call.name),
        arguments: call.arguments ?? {},
      }));

      // Scope check: verify device has permission for requested tools
      // Derive tool tier from ToolRegistry metadata (fail-closed for unknown tools)
      for (const call of toolCalls) {
        const tier = getToolTier(call.name, tools);
        if (tier === null) {
          sendJson(res, 403, {
            ok: false,
            error: {
              code: "ERR_UNKNOWN_TOOL",
              message: `Unknown or unregistered tool: ${call.name}`,
            },
          });
          return;
        }
        const scopeError = checkToolScope(device.scope, call.name, tier);
        if (scopeError) {
          sendJson(res, 403, {
            ok: false,
            error: scopeError,
          });
          return;
        }
        // P0 fix: MCP tools require mcp scope
        if (call.name.includes("__")) {
          const mcpScopeError = checkMcpScope(device.scope);
          if (mcpScopeError) {
            sendJson(res, 403, {
              ok: false,
              error: mcpScopeError,
            });
            return;
          }
        }
      }

      const now = Date.now();
      const idempotencyKey = getHeader(req, "idempotency-key");
      const requestHash = hashRequest(
        req.method ?? "POST",
        url.pathname,
        rawBody,
        device.deviceId
      );
      if (idempotencyKey) {
        const cached = store.getIdempotency(idempotencyKey);
        if (
          cached &&
          cached.requestHash === requestHash &&
          cached.expiresAt > now
        ) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(cached.responseJson);
          return;
        }
      }

      const { allowed, resetAt } = store.checkRateLimit(
        `device:${device.deviceId}`,
        config.rateLimit.windowMs,
        config.rateLimit.max,
        now
      );
      if (!allowed) {
        sendJson(res, 429, {
          ok: false,
          error: {
            code: "ERR_RATE_LIMIT",
            message: "Too many requests",
          },
          resetAt,
        });
        return;
      }

      const resultsMap = await executeToolCalls(toolCalls, {
        registry: tools,
        auditLogger: createNoopAuditLogger(),
        context: {
          sessionKey: `gateway:${device.deviceId}`,
          agentId: "gateway/http",
          config: {},
        },
        securityConfig: { writeGateEnabled: false },
      });

      const results = toolCalls.map((call) => {
        const result = resultsMap.get(call.id) ?? {
          success: false,
          error: "Tool execution failed",
        };
        return normalizeToolResult(call, result);
      });

      const eventTime = Date.now();
      const allOk = results.every((r) => r.success);
      store.insertEvent({
        type: "command.tool",
        time: eventTime,
        status: allOk ? "success" : "error",
        source: device.deviceId,
        message: "tool calls executed",
        metadataJson: JSON.stringify({ results, targetDeviceId: device.deviceId }),
        expiresAt: eventTime + config.eventTtlMs,
      });

      const responsePayload = { ok: true, data: { results } };
      sendJson(res, 200, responsePayload);
      if (idempotencyKey) {
        store.saveIdempotency(
          idempotencyKey,
          requestHash,
          responsePayload,
          now + config.idempotencyTtlMs
        );
      }
      return;
    }

    if (url.pathname === "/command/system" && req.method === "POST") {
      const authResult = await requireDeviceAuth(req, store, remoteIp);
      if (!authResult.ok) {
        sendJson(res, authResult.status, authResult.error);
        return;
      }
      const { device } = authResult;

      // Scope check: require system permission
      const scopeError = checkSystemScope(device.scope);
      if (scopeError) {
        sendJson(res, 403, {
          ok: false,
          error: scopeError,
        });
        return;
      }

      let rawBody = "";
      let body: any;
      try {
        rawBody = await readBodyString(req);
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }

      const now = Date.now();
      const idempotencyKey = getHeader(req, "idempotency-key");
      const requestHash = hashRequest(
        req.method ?? "POST",
        url.pathname,
        rawBody,
        device.deviceId
      );
      if (idempotencyKey) {
        const cached = store.getIdempotency(idempotencyKey);
        if (
          cached &&
          cached.requestHash === requestHash &&
          cached.expiresAt > now
        ) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(cached.responseJson);
          return;
        }
      }

      const { allowed, resetAt } = store.checkRateLimit(
        `device:${device.deviceId}`,
        config.rateLimit.windowMs,
        config.rateLimit.max,
        now
      );
      if (!allowed) {
        sendJson(res, 429, {
          ok: false,
          error: {
            code: "ERR_RATE_LIMIT",
            message: "Too many requests",
          },
          resetAt,
        });
        return;
      }

      const result = await executeSystemRequest(
        body,
        {
          workspacePath,
          fetchImpl,
        },
        opts.system
      );

      const eventTime = Date.now();
      store.insertEvent({
        type: "command.system",
        time: eventTime,
        status: result.success ? "success" : "error",
        source: device.deviceId,
        message: "system action executed",
        metadataJson: JSON.stringify({ result, targetDeviceId: device.deviceId }),
        expiresAt: eventTime + config.eventTtlMs,
      });

      const responsePayload = { ok: true, data: { result } };
      sendJson(res, 200, responsePayload);
      if (idempotencyKey) {
        store.saveIdempotency(
          idempotencyKey,
          requestHash,
          responsePayload,
          now + config.idempotencyTtlMs
        );
      }
      return;
    }

    // MCP route — JSON-RPC 2.0 endpoint for MCP tools
    if (url.pathname === "/mcp" && req.method === "POST") {
      const authResult = await requireDeviceAuth(req, store, remoteIp);
      if (!authResult.ok) {
        sendJson(res, authResult.status, authResult.error);
        return;
      }
      const { device } = authResult;

      // Scope check: require MCP permission
      const scopeError = checkMcpScope(device.scope);
      if (scopeError) {
        sendJson(res, 403, {
          ok: false,
          error: scopeError,
        });
        return;
      }

      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJsonRpc(res, null, { code: -32700, message: "Parse error" });
        return;
      }

      if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
        sendJsonRpc(res, body?.id ?? null, { code: -32600, message: "Invalid Request" });
        return;
      }

      const rpcId = body.id ?? null;

      if (body.method === "tools/list") {
        // Return all MCP-originated tools (names contain __)
        const mcpTools = tools.getAll().filter((t) => t.name.includes("__"));
        sendJsonRpc(res, rpcId, undefined, {
          tools: mcpTools.map((t) => ({
            name: t.name,
            description: t.description ?? "",
            inputSchema: t.parameters ?? { type: "object", properties: {} },
          })),
        });
        return;
      }

      if (body.method === "tools/call") {
        const params = body.params as any;
        const toolName = params?.name;
        const toolArgs = params?.arguments ?? {};

        if (typeof toolName !== "string" || !toolName.includes("__")) {
          sendJsonRpc(res, rpcId, { code: -32602, message: "Invalid params: name must be a valid MCP tool (serverName__toolName)" });
          return;
        }

        if (!tools.get(toolName)) {
          sendJsonRpc(res, rpcId, { code: -32602, message: `Tool not found: ${toolName}` });
          return;
        }

        // P0 fix: check tool-level scope (read/write/sign) for MCP tools
        const mcpToolTier = getToolTier(toolName, tools);
        if (mcpToolTier !== null) {
          const toolScopeError = checkToolScope(device.scope, toolName, mcpToolTier);
          if (toolScopeError) {
            sendJsonRpc(res, rpcId, { code: -32603, message: toolScopeError.message ?? "Insufficient tool scope" });
            return;
          }
        }

        const { allowed, resetAt } = store.checkRateLimit(
          `device:${device.deviceId}`,
          config.rateLimit.windowMs,
          config.rateLimit.max,
          Date.now()
        );
        if (!allowed) {
          sendJson(res, 429, {
            ok: false,
            error: { code: "ERR_RATE_LIMIT", message: "Too many requests" },
            resetAt,
          });
          return;
        }

        const mcpCallId = String(rpcId ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        const toolCall: ToolCall = { id: mcpCallId, name: toolName, arguments: toolArgs };
        const resultsMap = await executeToolCalls([toolCall], {
          registry: tools,
          auditLogger: createNoopAuditLogger(),
          context: {
            sessionKey: `gateway:${device.deviceId}`,
            agentId: "gateway/mcp",
            config: {},
          },
          securityConfig: { writeGateEnabled: false },
        });

        const result = resultsMap.get(mcpCallId);
        if (result && result.success) {
          sendJsonRpc(res, rpcId, undefined, {
            content: [{ type: "text", text: typeof result.data === "string" ? result.data : JSON.stringify(result.data) }],
            isError: false,
          });
        } else {
          sendJsonRpc(res, rpcId, undefined, {
            content: [{ type: "text", text: result?.error ?? "Tool execution failed" }],
            isError: true,
          });
        }
        return;
      }

      if (body.method === "servers/list") {
        // Derive server list from MCP tool name prefixes
        const mcpTools = tools.getAll().filter((t) => t.name.includes("__"));
        const serverMap = new Map<string, string[]>();
        for (const t of mcpTools) {
          const [serverName] = t.name.split("__", 2);
          const list = serverMap.get(serverName) ?? [];
          list.push(t.name);
          serverMap.set(serverName, list);
        }
        const servers = Array.from(serverMap.entries()).map(([name, toolNames]) => ({
          name,
          toolCount: toolNames.length,
          tools: toolNames,
        }));
        sendJsonRpc(res, rpcId, undefined, { servers });
        return;
      }

      // Unknown method
      sendJsonRpc(res, rpcId, { code: -32601, message: `Method not found: ${body.method}` });
      return;
    }

    // =========================================================================
    // 404 Not Found
    // =========================================================================

    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: "ERR_INVALID_REQUEST", message: "Not Found" },
      })
    );
  };

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  let listening = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => {
        reject(err);
      };
      server.once("error", onError);
      server.listen(config.port, config.host, () => {
        server.off("error", onError);
        resolve();
      });
    });
  } catch (err: any) {
    // Some CI/sandbox environments disallow binding to loopback/ports.
    // Keep the server usable via `result.request()` without a listening socket.
    if (err && (err.code === "EPERM" || err.code === "EACCES")) {
      listening = false;
    } else {
      throw err;
    }
  }

  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : config.port;

  const request: GatewayHttpResult["request"] = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = init?.headers ?? {};
    const body = init?.body ?? "";
    const remoteIp = init?.remoteIp ?? "127.0.0.1";

    // Minimal IncomingMessage mock: async iterable body + required props.
    const req = Readable.from(body ? [Buffer.from(body, "utf8")] : []) as any;
    req.method = method;
    req.url = path;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    req.socket = { remoteAddress: remoteIp };

    // Minimal ServerResponse mock capturing status, headers, and body.
    let status = 200;
    const outHeaders: Record<string, string> = {};
    const chunks: Buffer[] = [];

    let resolveDone: ((r: Response) => void) | null = null;
    const done = new Promise<Response>((resolve) => {
      resolveDone = resolve;
    });

    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    }) as any;

    res.writeHead = (s: number, h?: Record<string, any>) => {
      status = s;
      if (h) {
        for (const [k, v] of Object.entries(h)) {
          if (typeof v === "string") outHeaders[k.toLowerCase()] = v;
        }
      }
      return res;
    };
    res.end = (chunk?: any) => {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const text = Buffer.concat(chunks).toString("utf8");
      const hdrs = new Headers();
      for (const [k, v] of Object.entries(outHeaders)) hdrs.set(k, v);
      resolveDone?.(new Response(text, { status, headers: hdrs }));
      return res;
    };

    await handler(req, res);
    return await done;
  };

  return {
    baseUrl: listening ? `http://${config.host}:${port}` : "http://in-memory",
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
    channel: httpChannel,
    request,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendJsonRpc(
  res: http.ServerResponse,
  id: string | number | null,
  error?: { code: number; message: string; data?: unknown },
  result?: unknown,
) {
  const body: Record<string, unknown> = { jsonrpc: "2.0", id };
  if (error) {
    body.error = error;
  } else {
    body.result = result;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function getRemoteIp(req: http.IncomingMessage): string {
  const ip = req.socket.remoteAddress ?? "";
  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

function getHeader(
  req: http.IncomingMessage,
  name: string
): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function requireGatewayAuth(
  req: http.IncomingMessage,
  token?: string
): boolean {
  if (!token) return true;
  const provided = req.headers["x-gateway-token"];
  return typeof provided === "string" && provided === token;
}

interface DeviceAuthSuccess {
  ok: true;
  device: {
    deviceId: string;
    scope: DeviceScope;
  };
}

interface DeviceAuthFailure {
  ok: false;
  status: number;
  error: { ok: false; error: { code: string; message: string }; data?: any };
}

type DeviceAuthResult = DeviceAuthSuccess | DeviceAuthFailure;

async function requireDeviceAuth(
  req: http.IncomingMessage,
  store: Store,
  remoteIp: string
): Promise<DeviceAuthResult> {
  // Check for API key auth first (Authorization: Bearer owk_...)
  const authHeader = getHeader(req, "authorization");
  // Tolerate extra whitespace: "Bearer  owk_..." or "Bearer   owk_..."
  const bearerMatch = authHeader?.match(/^Bearer\s+(owk_.+)$/i);
  if (bearerMatch) {
    const apiKey = bearerMatch[1];
    const keyHash = hashToken(apiKey);
    const record = store.getApiKeyByHash(keyHash);
    if (!record) {
      return {
        ok: false,
        status: 401,
        error: {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Invalid API key" },
        },
      };
    }
    if (record.revokedAt) {
      return {
        ok: false,
        status: 401,
        error: {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "API key revoked" },
        },
      };
    }
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      return {
        ok: false,
        status: 401,
        error: {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "API key expired" },
        },
      };
    }
    store.touchApiKeyUsed(record.id, Date.now());
    return {
      ok: true,
      device: {
        deviceId: `apikey:${record.id}`,
        scope: record.scope,
      },
    };
  }

  const deviceId = getHeader(req, "x-device-id");
  const deviceToken = getHeader(req, "x-device-token");

  if (!deviceId) {
    return {
      ok: false,
      status: 401,
      error: {
        ok: false,
        error: { code: "ERR_UNAUTHORIZED", message: "Missing X-Device-Id" },
      },
    };
  }

  if (!deviceToken) {
    // Auto-enroll into pairing pending
    const userAgent = String(req.headers["user-agent"] ?? "");
    store.addPending(deviceId, remoteIp, userAgent);
    return {
      ok: false,
      status: 401,
      error: {
        ok: false,
        error: { code: "ERR_DEVICE_NOT_PAIRED", message: "Device not paired" },
        data: { deviceId, pairing: "pending" },
      },
    };
  }

  const device = store.getDevice(deviceId);
  if (!device || device.revokedAt || !device.tokenHash) {
    const userAgent = String(req.headers["user-agent"] ?? "");
    store.addPending(deviceId, remoteIp, userAgent);
    return {
      ok: false,
      status: 401,
      error: {
        ok: false,
        error: { code: "ERR_DEVICE_NOT_PAIRED", message: "Device not paired" },
        data: { deviceId, pairing: "pending" },
      },
    };
  }

  if (hashToken(deviceToken) !== device.tokenHash) {
    return {
      ok: false,
      status: 401,
      error: {
        ok: false,
        error: { code: "ERR_UNAUTHORIZED", message: "Invalid device token" },
      },
    };
  }

  // Update last_seen_at for observability
  store.touchDeviceSeen(deviceId, Date.now());

  return {
    ok: true,
    device: {
      deviceId,
      scope: device.scope,
    },
  };
}

function normalizeToolResult(call: ToolCall, result: ToolResult) {
  return {
    id: call.id,
    name: call.name,
    success: result.success,
    data: result.data,
    error: result.error,
  };
}

/**
 * Get tool tier based on tool name.
 * This is a heuristic - real implementation would check tool registry metadata.
 */
function getToolTier(
  toolName: string,
  toolRegistry: ToolRegistry,
): "none" | "tier3" | "tier2" | "tier1" | null {
  const tool = toolRegistry.get(toolName);
  if (!tool?.security?.level) {
    // Unknown tool or missing security metadata → fail closed
    return null;
  }
  switch (tool.security.level) {
    case "read":
      return "none";
    case "write":
      return "tier3";
    case "sign":
      // Conservative: sign tools get tier1 (highest restriction)
      return "tier1";
    default:
      return null;
  }
}

async function readBodyString(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 1_000_000) {
      throw new Error("Body too large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const raw = await readBodyString(req);
  if (!raw) return null;
  return JSON.parse(raw);
}
