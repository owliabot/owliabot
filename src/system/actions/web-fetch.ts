import { webFetchArgsSchema, type SystemCapabilityConfig, type WebFetchArgs } from "../interface.js";
import { checkUrlAgainstDomainPolicy } from "../security/domain-policy.js";
import { scanForSecrets } from "../security/secret-scanner.js";

export interface WebFetchActionContext {
  fetchImpl?: typeof fetch;
}

export interface WebFetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  truncated: boolean;
  durationMs: number;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "HEAD"]);

async function readResponseTextWithLimit(
  res: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (!body) return { text: "", truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
      chunks.push(value);
    }
  }

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString("utf8"), truncated };
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

export async function webFetchAction(
  argsRaw: unknown,
  ctx: WebFetchActionContext,
  webCfg: SystemCapabilityConfig["web"]
): Promise<WebFetchResult> {
  const args = webFetchArgsSchema.parse(argsRaw) as WebFetchArgs;

  const policyVerdict = checkUrlAgainstDomainPolicy(args.url, {
    allowList: webCfg?.domainAllowList ?? [],
    denyList: webCfg?.domainDenyList ?? [],
    allowPrivateNetworks: webCfg?.allowPrivateNetworks ?? false,
  });
  if (!policyVerdict.allowed) {
    throw new Error(`URL blocked by policy: ${policyVerdict.reason ?? "denied"}`);
  }

  const method = (args.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Method not allowed: ${method}`);
  }

  const timeoutMs = args.timeoutMs ?? webCfg?.timeoutMs ?? 15_000;
  const maxResponseBytes = args.maxResponseBytes ?? webCfg?.maxResponseBytes ?? 512 * 1024;

  const headers: Record<string, string> = { ...(args.headers ?? {}) };
  if (webCfg?.userAgent && !headers["user-agent"]) {
    headers["user-agent"] = webCfg.userAgent;
  }

  if (method !== "GET" && method !== "HEAD") {
    const body = args.body ?? "";
    if (webCfg?.blockOnSecret ?? true) {
      const scan = scanForSecrets(body);
      if (scan.hasHighConfidence) {
        throw new Error(
          `Request body blocked by secret scanner: ${scan.findings.map((f) => f.type).join(",")}`
        );
      }
    }
  }

  const fetchImpl = ctx.fetchImpl ?? fetch;
  const ac = new AbortController();
  const started = Date.now();
  const t = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetchImpl(args.url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : args.body,
      redirect: "manual",
      signal: ac.signal,
    });

    const { text, truncated } = await readResponseTextWithLimit(res, maxResponseBytes);

    return {
      url: args.url,
      status: res.status,
      headers: headersToObject(res.headers),
      bodyText: text,
      truncated,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(t);
  }
}
