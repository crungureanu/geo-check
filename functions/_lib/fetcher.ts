import type { FetchedDoc, RootFiles } from "./types";

const SCANNER_UA =
  "Mozilla/5.0 (compatible; RankFixBot/0.1; +https://rankfix.ai/bot)";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2_500_000; // 2.5 MB cap per doc

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

  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": ua, Accept: "*/*" },
      redirect: "follow",
      signal: controller.signal,
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    let body = "";
    if (method !== "HEAD" && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
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
    }

    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      contentType: headers["content-type"] ?? null,
      headers,
      body,
      redirectChain: res.redirected ? 1 : 0,
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

  const robots = await robotsPromise;
  const llmsTxt = await llmsPromise;

  let sitemapUrl: string | null = null;
  if (robots.ok && robots.body) {
    const m = robots.body.match(/^\s*Sitemap:\s*(\S+)/im);
    if (m) sitemapUrl = m[1].trim();
  }
  if (!sitemapUrl) sitemapUrl = new URL("/sitemap.xml", origin).toString();

  const sitemap = await fetchDoc(sitemapUrl, { timeoutMs: 8000 });

  return {
    robots: robots.fetchError && robots.status === 0 ? null : robots,
    sitemap: sitemap.fetchError && sitemap.status === 0 ? null : sitemap,
    sitemapUrl,
    llmsTxt: llmsTxt.fetchError && llmsTxt.status === 0 ? null : llmsTxt,
  };
}

export { SCANNER_UA };
