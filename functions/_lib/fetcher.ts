import type { FetchedDoc, RootFiles } from "./types";

const SCANNER_UA =
  "Mozilla/5.0 (compatible; RankFixBot/0.1; +https://rankfix.ai/bot)";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2_500_000; // 2.5 MB cap per doc
const MAX_REDIRECTS = 8; // hard cap on HTTP + meta-refresh hops combined

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
  opts: { timeoutMs?: number; ua?: string; method?: "GET" | "HEAD" } = {},
): Promise<FetchedDoc> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ua = opts.ua ?? SCANNER_UA;
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
      res = await fetch(currentUrl, {
        method,
        headers: { "User-Agent": ua, Accept: "*/*" },
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
      if (refreshTarget && refreshTarget !== finalUrl) {
        const res2 = await fetch(refreshTarget, {
          method,
          headers: { "User-Agent": ua, Accept: "*/*" },
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
  const res = await fetchDoc(url, { method: "HEAD", ua, timeoutMs: 5000 });
  return { status: res.status, headers: res.headers, ok: res.ok, error: res.fetchError };
}

export async function fetchRootFiles(origin: string): Promise<RootFiles> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const llmsUrl = new URL("/llms.txt", origin).toString();

  const robotsPromise = fetchDoc(robotsUrl, { timeoutMs: 6000 });
  const llmsPromise = fetchDoc(llmsUrl, { timeoutMs: 6000 });

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
    sitemap = await fetchDoc(sitemapUrl, { timeoutMs: 8000 });
  } else {
    // robots.txt did not advertise a sitemap: probe common fallbacks. Many
    // sites only ship /sitemap-index.xml or /sitemap_index.xml (B4).
    const candidates = ["/sitemap.xml", "/sitemap-index.xml", "/sitemap_index.xml"];
    let picked: FetchedDoc | null = null;
    for (const path of candidates) {
      const u = new URL(path, origin).toString();
      const r = await fetchDoc(u, { timeoutMs: 8000 });
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
