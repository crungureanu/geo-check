import { fetchDoc, fetchRootFiles } from "../_lib/fetcher";
import { extractPageData } from "../_lib/extractor";
import { expandSitemap, selectPages, classifyUrl } from "../_lib/page-selector";
import { fetchPageSpeed } from "../_lib/pagespeed";
import { robotsChecks } from "../_lib/checks/robots";
import { discoveryChecks } from "../_lib/checks/discovery";
import { schemaChecks } from "../_lib/checks/schema";
import { extractabilityChecks } from "../_lib/checks/extractability";
import { citabilityChecks } from "../_lib/checks/citability";
import { answerShapeChecks } from "../_lib/checks/answer-shape";
import { classicSeoChecks } from "../_lib/checks/classic-seo";
import { extrasChecks } from "../_lib/checks/extras";
import { computeScores, dedupeFindings, sortFindings } from "../_lib/scoring";
import { saveScan } from "../_lib/kv";
import { generateDeepLinks } from "../_lib/deep-links";
import type { CheckContext, Finding, PageInfo, ScanResult } from "../_lib/types";

interface Env {
  PAGESPEED_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  SHARES?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function performScan(targetUrl: string, env: Env): Promise<ScanResult> {
  const startedAt = Date.now();
  const baseUrl = new URL(targetUrl);
  const origin = baseUrl.origin;

  const rootFiles = await fetchRootFiles(origin);
  const sitemapUrls = await expandSitemap(rootFiles.sitemap, origin);

  let selected: Array<{ url: string; type: ReturnType<typeof classifyUrl> }>;
  if (sitemapUrls.length > 0) {
    selected = selectPages(sitemapUrls, targetUrl, origin, 10);
  } else {
    selected = [{ url: targetUrl, type: classifyUrl(targetUrl) }];
    if (classifyUrl(targetUrl) !== "home") {
      selected.unshift({ url: `${origin}/`, type: "home" });
    }
  }

  const fetched = await Promise.all(
    selected.map((s) => fetchDoc(s.url, { timeoutMs: 8000 })),
  );
  const pages = fetched.map((f) => extractPageData(f));

  // If every fetch failed, the site is unreachable from our Worker.
  // Don't pretend to score it; surface a real error.
  const anyOk = pages.some((p) => p.status > 0 && p.status < 400);
  if (!anyOk) {
    const statuses = pages.map((p) => (p.status ? String(p.status) : "no response")).join(", ");
    throw new Error(
      `Could not reach ${baseUrl.host}. Every page fetch failed (status: ${statuses}). Common causes: SSL/TLS misconfiguration on the site, a WAF blocking unknown crawlers, or the site is offline. Open ${baseUrl.href} in a browser to confirm it loads.`,
    );
  }

  const homeIdx = selected.findIndex((s) => s.type === "home");
  if (homeIdx >= 0 && env.PAGESPEED_API_KEY) {
    try {
      pages[homeIdx].pagespeed = await fetchPageSpeed(
        pages[homeIdx].finalUrl,
        env.PAGESPEED_API_KEY,
      );
    } catch {
      pages[homeIdx].pagespeed = null;
    }
  }

  const allFindings: Finding[] = [];
  const pageInfos: PageInfo[] = [];

  for (let i = 0; i < selected.length; i++) {
    const page = pages[i];
    const sel = selected[i];
    const pageInfo: PageInfo = {
      url: page.finalUrl || sel.url,
      type: sel.type,
      status: page.status,
    };
    pageInfos.push(pageInfo);

    if (!page.status || page.status >= 400) {
      allFindings.push({
        id: `fetch.failed:${pageInfo.url}`,
        status: "fail",
        severity: "important",
        discipline: "both",
        title: `Could not fetch ${pageInfo.url}`,
        message: `HTTP status ${page.status}. ${pageInfo.url} was skipped during scoring.`,
      });
      continue;
    }

    const ctx: CheckContext = {
      page,
      pageInfo,
      rootFiles,
      isHome: sel.type === "home",
    };

    allFindings.push(...robotsChecks(ctx));
    allFindings.push(...discoveryChecks(ctx));
    allFindings.push(...schemaChecks(ctx));
    allFindings.push(...extractabilityChecks(ctx));
    allFindings.push(...citabilityChecks(ctx));
    allFindings.push(...answerShapeChecks(ctx));
    allFindings.push(...classicSeoChecks(ctx));
    allFindings.push(...extrasChecks(ctx));
  }

  const deduped = dedupeFindings(allFindings);
  const sorted = sortFindings(deduped);
  const scores = computeScores(deduped);
  const deepLinks = generateDeepLinks(baseUrl.host);

  return {
    url: targetUrl,
    scannedPages: pageInfos,
    scores,
    findings: sorted,
    deepLinks,
    scannedAt: new Date(startedAt).toISOString(),
    ttl: 7 * 24 * 60 * 60,
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const raw = body.url?.trim();
  if (!raw) return json({ error: "url is required" }, 400);

  let parsed: URL;
  try {
    parsed = new URL(raw.match(/^https?:\/\//i) ? raw : `https://${raw}`);
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json({ error: "Only http(s) URLs are supported" }, 400);
  }

  try {
    const result = await performScan(parsed.toString(), env);
    const id = await saveScan(env.SHARES, result);
    return json({ ok: true, result: id ? { ...result, id } : result });
  } catch (err: any) {
    return json(
      { error: "scan_failed", message: err?.message ?? "unknown error" },
      500,
    );
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};
