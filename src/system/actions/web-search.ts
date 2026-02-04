import { webSearchArgsSchema, type SystemCapabilityConfig, type WebSearchArgs } from "../interface.js";
import { checkUrlAgainstDomainPolicy } from "../security/domain-policy.js";

export interface WebSearchActionContext {
  fetchImpl?: typeof fetch;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchResult {
  provider: "brave" | "duckduckgo";
  query: string;
  results: WebSearchResultItem[];
  durationMs: number;
}

function safeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseDuckDuckGoHtml(html: string, max: number): WebSearchResultItem[] {
  const out: WebSearchResultItem[] = [];

  // Common DDG HTML patterns (best-effort)
  const re = /<a[^>]+class="[^"]*(?:result__a|result-link)[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1] ?? "";
    const rawTitle = m[2] ?? "";

    const title = safeText(decodeHtmlEntities(rawTitle.replace(/<[^>]*>/g, "")));
    const url = safeText(decodeHtmlEntities(href));

    if (!title || !url) continue;
    out.push({ title, url });
    if (out.length >= max) break;
  }

  // Fallback: try generic anchors inside result containers
  if (out.length === 0) {
    const re2 = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{3,200})<\/a>/gi;
    while ((m = re2.exec(html))) {
      const url = safeText(decodeHtmlEntities(m[1] ?? ""));
      const title = safeText(decodeHtmlEntities(m[2] ?? ""));
      if (!title || !url) continue;
      out.push({ title, url });
      if (out.length >= max) break;
    }
  }

  return out;
}

function parseBraveJson(json: any, max: number): WebSearchResultItem[] {
  const items: WebSearchResultItem[] = [];
  const web = json?.web;
  const results = Array.isArray(web?.results) ? web.results : [];
  for (const r of results) {
    const title = typeof r?.title === "string" ? r.title : "";
    const url = typeof r?.url === "string" ? r.url : "";
    const snippet = typeof r?.description === "string" ? r.description : undefined;
    if (!title || !url) continue;
    items.push({ title, url, snippet });
    if (items.length >= max) break;
  }
  return items;
}

export async function webSearchAction(
  argsRaw: unknown,
  ctx: WebSearchActionContext,
  cfg: SystemCapabilityConfig
): Promise<WebSearchResult> {
  const args = webSearchArgsSchema.parse(argsRaw) as WebSearchArgs;

  const webCfg = cfg.web;
  const policy = {
    allowList: webCfg?.domainAllowList ?? [],
    denyList: webCfg?.domainDenyList ?? [],
    allowPrivateNetworks: webCfg?.allowPrivateNetworks ?? false,
  };

  const provider = args.provider ?? cfg.webSearch?.defaultProvider ?? "duckduckgo";
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const started = Date.now();

  const maxResults = Math.min(
    args.count ?? 10,
    cfg.webSearch?.maxResults ?? 10
  );

  const timeoutMs = args.timeoutMs ?? cfg.webSearch?.timeoutMs ?? webCfg?.timeoutMs ?? 15_000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    if (provider === "brave") {
      const braveCfg = cfg.webSearch?.brave;
      if (!braveCfg?.apiKey) {
        throw new Error("Brave API key not configured");
      }
      const endpoint = braveCfg.endpoint ?? "https://api.search.brave.com/res/v1/web/search";
      const u = new URL(endpoint);
      u.searchParams.set("q", args.query);
      u.searchParams.set("count", String(maxResults));

      const verdict = checkUrlAgainstDomainPolicy(u.toString(), policy);
      if (!verdict.allowed) {
        throw new Error(`Search endpoint blocked by policy: ${verdict.reason ?? "denied"}`);
      }

      const res = await fetchImpl(u.toString(), {
        method: "GET",
        headers: {
          "accept": "application/json",
          "x-subscription-token": braveCfg.apiKey,
          ...(webCfg?.userAgent ? { "user-agent": webCfg.userAgent } : {}),
        },
        redirect: "manual",
        signal: ac.signal,
      });

      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON from Brave search");
      }

      return {
        provider: "brave",
        query: args.query,
        results: parseBraveJson(json, maxResults),
        durationMs: Date.now() - started,
      };
    }

    // DuckDuckGo
    const endpoint = cfg.webSearch?.duckduckgo?.endpoint ?? "https://duckduckgo.com/html/";
    const u = new URL(endpoint);
    u.searchParams.set("q", args.query);

    const verdict = checkUrlAgainstDomainPolicy(u.toString(), policy);
    if (!verdict.allowed) {
      throw new Error(`Search endpoint blocked by policy: ${verdict.reason ?? "denied"}`);
    }

    const res = await fetchImpl(u.toString(), {
      method: "GET",
      headers: {
        "accept": "text/html",
        ...(webCfg?.userAgent ? { "user-agent": webCfg.userAgent } : {}),
      },
      redirect: "manual",
      signal: ac.signal,
    });

    const html = await res.text();
    return {
      provider: "duckduckgo",
      query: args.query,
      results: parseDuckDuckGoHtml(html, maxResults),
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(t);
  }
}
