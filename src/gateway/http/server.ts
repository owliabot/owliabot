import http from "node:http";
import { createStore } from "./store.js";
import { executeToolCalls } from "../../agent/tools/executor.js";
import type { ToolCall, ToolResult } from "../../agent/tools/interface.js";
import type { ToolRegistry } from "../../agent/tools/registry.js";
import type { SessionStore } from "../../agent/session-store.js";
import type { SessionTranscriptStore } from "../../agent/session-transcript.js";
import { createGatewayToolRegistry } from "./tooling.js";
import { hashRequest, hashToken, isIpAllowed } from "./utils.js";
import { executeSystemRequest } from "../../system/executor.js";
import type { SystemCapabilityConfig } from "../../system/interface.js";

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
}

/**
 * Start the Gateway HTTP server.
 *
 * Phase 1 of Gateway Unification: accepts shared resources from main gateway.
 * When toolRegistry/sessionStore/transcripts are provided, uses them directly
 * instead of creating duplicates. Falls back to createGatewayToolRegistry for
 * backward compatibility (standalone usage, tests).
 *
 * @see docs/plans/gateway-unification.md
 */
export async function startGatewayHttp(opts: {
  config: GatewayHttpConfig;
  /** Shared tool registry from main gateway (Phase 1 unification) */
  toolRegistry?: ToolRegistry;
  /** Shared session store from main gateway (Phase 1 unification) */
  sessionStore?: SessionStore;
  /** Shared transcript store from main gateway (Phase 1 unification) */
  transcripts?: SessionTranscriptStore;
  workspacePath?: string;
  system?: SystemCapabilityConfig;
}) {
  const store = createStore(opts.config.sqlitePath);

  // Phase 1: Use shared registry if provided, otherwise fall back to local creation
  // (backward compat for tests and standalone usage)
  const tools = opts.toolRegistry
    ? opts.toolRegistry
    : await createGatewayToolRegistry(opts.workspacePath ?? process.cwd());
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const remoteIp = getRemoteIp(req);

    // Opportunistic cleanup to keep sqlite tables bounded.
    // (Cheap: single DELETE on TTL tables.)
    store.cleanup(Date.now());

    if (
      opts.config.allowlist.length > 0 &&
      !isIpAllowed(remoteIp, opts.config.allowlist)
    ) {
      sendJson(res, 403, {
        ok: false,
        error: { code: "ERR_FORBIDDEN", message: "IP not allowed" },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: true, version: "0.1.0", uptime: process.uptime() })
      );
      return;
    }

    if (url.pathname === "/status" && req.method === "GET") {
      if (!requireGatewayAuth(req, opts.config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const pending = store.listPending();
      const devices = store.listDevices().map((d) => ({
        deviceId: d.deviceId,
        revokedAt: d.revokedAt,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
        // never expose token hash via status
      }));
      sendJson(res, 200, {
        ok: true,
        data: {
          devices,
          pending,
        },
      });
      return;
    }

    if (url.pathname === "/pairing/pending" && req.method === "GET") {
      if (!requireGatewayAuth(req, opts.config.token)) {
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

    if (url.pathname === "/pairing/approve" && req.method === "POST") {
      if (!requireGatewayAuth(req, opts.config.token)) {
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
      const deviceToken = store.approveDevice(deviceId);
      sendJson(res, 200, {
        ok: true,
        data: { deviceId, deviceToken },
      });
      return;
    }

    if (url.pathname === "/pairing/revoke" && req.method === "POST") {
      if (!requireGatewayAuth(req, opts.config.token)) {
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

    if (url.pathname === "/events/poll" && req.method === "GET") {
      const sinceParam = url.searchParams.get("since");
      const since = sinceParam ? Number(sinceParam) : null;
      const now = Date.now();
      const { cursor, events } = store.pollEvents(
        Number.isFinite(since) ? since : null,
        100,
        now
      );
      sendJson(res, 200, { ok: true, cursor, events });
      return;
    }

    if (url.pathname === "/command/tool" && req.method === "POST") {
      const deviceId = getHeader(req, "x-device-id");
      const deviceToken = getHeader(req, "x-device-token");

      if (!deviceId) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing X-Device-Id" },
        });
        return;
      }

      if (!deviceToken) {
        // Auto-enroll into pairing pending to match the intended flow.
        const userAgent = String(req.headers["user-agent"] ?? "");
        store.addPending(deviceId, remoteIp, userAgent);
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_DEVICE_NOT_PAIRED", message: "Device not paired" },
          data: { deviceId, pairing: "pending" },
        });
        return;
      }

      const device = store.getDevice(deviceId);
      if (!device || device.revokedAt || !device.tokenHash) {
        const userAgent = String(req.headers["user-agent"] ?? "");
        store.addPending(deviceId, remoteIp, userAgent);
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_DEVICE_NOT_PAIRED", message: "Device not paired" },
          data: { deviceId, pairing: "pending" },
        });
        return;
      }
      if (hashToken(deviceToken) !== device.tokenHash) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Invalid device token" },
        });
        return;
      }

      // Update last_seen_at for observability.
      store.touchDeviceSeen(deviceId, Date.now());

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

      const now = Date.now();
      const idempotencyKey = getHeader(req, "idempotency-key");
      const requestHash = hashRequest(
        req.method ?? "POST",
        url.pathname,
        rawBody,
        deviceId
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
        `device:${deviceId}`,
        opts.config.rateLimit.windowMs,
        opts.config.rateLimit.max,
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
        context: {
          sessionKey: `gateway:${deviceId}`,
          agentId: "gateway/http",
          config: {},
        },
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
        source: deviceId,
        message: "tool calls executed",
        metadataJson: JSON.stringify({ results }),
        expiresAt: eventTime + opts.config.eventTtlMs,
      });

      const responsePayload = { ok: true, data: { results } };
      sendJson(res, 200, responsePayload);
      if (idempotencyKey) {
        store.saveIdempotency(
          idempotencyKey,
          requestHash,
          responsePayload,
          now + opts.config.idempotencyTtlMs
        );
      }
      return;
    }

    if (url.pathname === "/command/system" && req.method === "POST") {
      const deviceId = getHeader(req, "x-device-id");
      const deviceToken = getHeader(req, "x-device-token");
      if (!deviceId || !deviceToken) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing device auth" },
        });
        return;
      }
      const device = store.getDevice(deviceId);
      if (!device || device.revokedAt || !device.tokenHash) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Device not paired" },
        });
        return;
      }
      if (hashToken(deviceToken) !== device.tokenHash) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Invalid device token" },
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
        deviceId
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
        `device:${deviceId}`,
        opts.config.rateLimit.windowMs,
        opts.config.rateLimit.max,
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
          workspacePath: opts.workspacePath ?? process.cwd(),
          fetchImpl: fetch,
        },
        opts.system
      );

      const eventTime = Date.now();
      store.insertEvent({
        type: "command.system",
        time: eventTime,
        status: result.success ? "success" : "error",
        source: deviceId,
        message: "system action executed",
        metadataJson: JSON.stringify({ result }),
        expiresAt: eventTime + opts.config.eventTtlMs,
      });

      const responsePayload = { ok: true, data: { result } };
      sendJson(res, 200, responsePayload);
      if (idempotencyKey) {
        store.saveIdempotency(
          idempotencyKey,
          requestHash,
          responsePayload,
          now + opts.config.idempotencyTtlMs
        );
      }
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: "ERR_INVALID_REQUEST", message: "Not Found" },
      })
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(opts.config.port, opts.config.host, () => resolve());
  });

  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : opts.config.port;

  return {
    baseUrl: `http://${opts.config.host}:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  res.writeHead(status, { "content-type": "application/json" });
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

function normalizeToolResult(call: ToolCall, result: ToolResult) {
  return {
    id: call.id,
    name: call.name,
    success: result.success,
    data: result.data,
    error: result.error,
  };
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
