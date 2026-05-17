import type { FetchedDoc, RootFiles } from "./types";
import type { ResourceBudget } from "./budget";

const SCANNER_UA =
  "Mozilla/5.0 (compatible; RankFixBot/0.1; +https://rankfix.ai/bot)";
// Page fetches send a real browser/crawler Accept. `Accept: */*` is a
// common WAF/edge bot signal: some sites 404 (or 406) it while serving
// 200 to anything that explicitly accepts HTML. Real AI crawlers
// (GPTBot, ClaudeBot) send a text/html Accept, so emulating */* made us
// MORE bot-like than the crawlers we model and false-404'd real pages
// (B16). Root files (robots/sitemap/llms/favicon) are text/xml, not
// HTML, and are not behind that rule, so they keep */* to stay
// behaviour-preserving where the bug does not apply.
const PAGE_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const ROOT_ACCEPT = "*/*";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2_500_000; // 2.5 MB cap per doc
const MAX_REDIRECTS = 6; // hard cap on HTTP + meta-refresh hops combined (A1: lowered from 8; gates both the redirect loop and meta-refresh, so leave headroom for chain-then-stub)

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// A 0/short-delay <meta http-equiv="refresh"> on a near-empty body is a
// client-side redirect stub (common for docs/landing shells). AI crawlers do
// not run JS but DO honour meta-refresh, so we resolve it server-side and
// score the destination, not the stub. Gated on a tiny body so a real
// content page that happens to carry a refresh tag is never replaced.
function findMetaRefreshTarget(body: string, baseUrl: string): string | null {
  const head = body.slice(0, 4096);
  const tag = head.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i);
  if (!tag) return null;
  const m = tag[0].match(/content\s*=\s*["']?\s*\d+\s*;\s*url\s*=\s*([^"'>\s]+)/i);
  if (!m) return null;
  const visibleLen = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  if (visibleLen >= 200) return null; // real content page: leave it alone
  try {
    return new URL(m[1].replace(/&amp;/g, "&"), baseUrl).toString();
  } catch {
    return null;
  }
}

export async function fetchDoc(
  url: string,
  opts: { timeoutMs?: number; ua?: string; method?: "GET" | "HEAD"; accept?: string; budget?: ResourceBudget } = {},
): Promise<FetchedDoc> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ua = opts.ua ?? SCANNER_UA;
  const accept = opts.accept ?? PAGE_ACCEPT;
  const method = opts.method ?? "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const emptyHeaders: Record<string, string> = {};
  const failed = (err: string, status = 0): FetchedDoc => ({
    url,
    finalUrl: url,
    status,
    ok: false,
    contentType: null,
    headers: emptyHeaders,
    body: "",
    redirectChain: 0,
    fetchError: err,
  });

  async function readBody(res: Response): Promise<string> {
    if (method === "HEAD" || !res.body) return "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          body += decoder.decode(value.subarray(0, value.byteLength - (total - MAX_BODY_BYTES)));
          try { await reader.cancel(); } catch {}
          break;
        }
        body += decoder.decode(value, { stream: true });
      }
    }
    body += decoder.decode();
    return body;
  }

  try {
    // Follow redirects manually so we can count real hops. fetch() with
    // redirect:"follow" hides the chain length (only res.redirected, a
    // boolean), which made discovery.redirect-chain dead code (B12-B).
    let currentUrl = url;
    let hops = 0;
    let res: Response;
    while (true) {
      // A1: count every hop (initial + each redirect) against the
      // per-scan budget. On exhaustion, abandon this fetch with a
      // distinct sentinel so scan.ts can drop it gracefully rather
      // than emit a phantom fetch.failed. Synchronous, no await.
      if (opts.budget && !opts.budget.tryConsume()) {
        return failed("budget-exhausted");
      }
      res = await fetch(currentUrl, {
        method,
        headers: { "User-Agent": ua, Accept: accept },
        redirect: "manual",
        signal: controller.signal,
      });
      const loc = res.headers.get("location");
      if (REDIRECT_STATUSES.has(res.status) && loc && hops < MAX_REDIRECTS) {
        let next: string;
        try { next = new URL(loc, currentUrl).toString(); } catch { break; }
        if (next === currentUrl) break; // self-redirect loop guard
        currentUrl = next;
        hops++;
        continue;
      }
      break;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    let finalUrl = res.url || currentUrl;
    let body = await readBody(res);
    let status = res.status;
    let ok = res.ok;
    let contentType = headers["content-type"] ?? null;

    // Meta-refresh stub resolution (one extra hop, gated on a tiny body).
    if (ok && method !== "HEAD" && hops < MAX_REDIRECTS) {
      const refreshTarget = findMetaRefreshTarget(body, finalUrl);
      // A1: meta-refresh is one more subrequest. If the budget is gone,
      // SKIP it and keep the already-fetched valid 200 (the page was
      // fetched successfully; only the optional stub hop is dropped).
      // Never return failed() here: that would discard a good response.
      if (
        refreshTarget &&
        refreshTarget !== finalUrl &&
        (!opts.budget || opts.budget.tryConsume())
      ) {
        const res2 = await fetch(refreshTarget, {
          method,
          headers: { "User-Agent": ua, Accept: accept },
          redirect: "follow",
          signal: controller.signal,
        });
        const h2: Record<string, string> = {};
        res2.headers.forEach((v, k) => { h2[k.toLowerCase()] = v; });
        hops++;
        finalUrl = res2.url || refreshTarget;
        body = await readBody(res2);
        status = res2.status;
        ok = res2.ok;
        contentType = h2["content-type"] ?? null;
        for (const k of Object.keys(h2)) headers[k] = h2[k];
      }
    }

    return {
      url,
      finalUrl,
      status,
      ok,
      contentType,
      headers,
      body,
      redirectChain: hops,
    };
  } catch (err: any) {
    return failed(err?.name === "AbortError" ? "timeout" : (err?.message ?? "fetch failed"));
  } finally {
    clearTimeout(timer);
  }
}

export async function headDoc(
  url: string,
  ua: string,
): Promise<{ status: number; headers: Record<string, string>; ok: boolean; error?: string }> {
  const res = await fetchDoc(url, { method: "HEAD", ua, timeoutMs: 5000, accept: ROOT_ACCEPT });
  return { status: res.status, headers: res.headers, ok: res.ok, error: res.fetchError };
}

export async function fetchRootFiles(origin: string): Promise<RootFiles> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const llmsUrl = new URL("/llms.txt", origin).toString();

  const robotsPromise = fetchDoc(robotsUrl, { timeoutMs: 6000, accept: ROOT_ACCEPT });
  const llmsPromise = fetchDoc(llmsUrl, { timeoutMs: 6000, accept: ROOT_ACCEPT });

  // Well-known favicon path. Frameworks like Next app-router serve
  // /favicon.ico without emitting a <link rel="icon"> in the document, so a
  // real favicon must not be reported missing (B9).
  const faviconPromise = headDoc(new URL("/favicon.ico", origin).toString(), SCANNER_UA);

  const robots = await robotsPromise;
  const llmsTxt = await llmsPromise;
  const faviconIco = await faviconPromise;

  let sitemapUrl: string | null = null;
  if (robots.ok && robots.body) {
    const m = robots.body.match(/^\s*Sitemap:\s*(\S+)/im);
    if (m) sitemapUrl = m[1].trim();
  }

  let sitemap: FetchedDoc;
  if (sitemapUrl) {
    sitemap = await fetchDoc(sitemapUrl, { timeoutMs: 8000, accept: ROOT_ACCEPT });
  } else {
    // robots.txt did not advertise a sitemap: probe common fallbacks. Many
    // sites only ship /sitemap-index.xml or /sitemap_index.xml (B4).
    const candidates = ["/sitemap.xml", "/sitemap-index.xml", "/sitemap_index.xml"];
    let picked: FetchedDoc | null = null;
    for (const path of candidates) {
      const u = new URL(path, origin).toString();
      const r = await fetchDoc(u, { timeoutMs: 8000, accept: ROOT_ACCEPT });
      if (r.ok) { picked = r; sitemapUrl = u; break; }
      if (!picked) { picked = r; sitemapUrl = u; } // keep first attempt for the not-found message
    }
    sitemap = picked!;
  }

  return {
    robots: robots.fetchError && robots.status === 0 ? null : robots,
    sitemap: sitemap.fetchError && sitemap.status === 0 ? null : sitemap,
    sitemapUrl,
    llmsTxt: llmsTxt.fetchError && llmsTxt.status === 0 ? null : llmsTxt,
    faviconIcoReachable: faviconIco.ok,
  };
}

export { SCANNER_UA };
