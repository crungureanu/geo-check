import { fetchDoc, fetchRootFiles } from "../_lib/fetcher";
import { extractPageData } from "../_lib/extractor";
import { expandSitemap, selectPages, classifyUrl, refineType } from "../_lib/page-selector";
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
  let pages = fetched.map((f) => extractPageData(f));

  // Post-fetch reconciliation (B15). selection (filter/dedupe/classify)
  // runs on the pre-redirect sitemap URL, but the page list and every
  // check use the post-redirect finalUrl, and nothing reconciled the
  // two. Any site that 301s sitemap URLs (cross-host, or many-to-one)
  // therefore showed off-site pages, duplicates, and wrong page types.
  // We rebuild selected+pages together (they are index-parallel with
  // fetched) BEFORE homeIdx / PageSpeed / the findings loop, all of
  // which index these arrays positionally.
  const offsiteNotes: string[] = [];
  {
    const scanHost = baseUrl.host.replace(/^www\./, "");
    // www/apex are the same site (the commonest redirect on the web);
    // a genuinely different subdomain (developer.x.com) is off-site.
    const sameSite = (u: string) => {
      try {
        return new URL(u).host.replace(/^www\./, "") === scanHost;
      } catch {
        return false;
      }
    };
    const normKey = (u: string) => {
      try {
        const x = new URL(u);
        return (
          x.host.toLowerCase() +
          x.pathname.toLowerCase().replace(/\/+$/, "")
        );
      } catch {
        return u;
      }
    };
    // A failed/redirect-capped fetch has finalUrl = the pre-fetch URL
    // (fetcher.ts), so only reason about origin/dedupe for real 2xx.
    const isReal = (p: (typeof pages)[number]) =>
      p.status >= 200 && p.status < 300;

    type Pair = { sel: (typeof selected)[number]; page: (typeof pages)[number] };
    let pairs: Pair[] = selected.map((sel, i) => ({ sel, page: pages[i] }));

    // 1. Drop genuinely off-site redirects. Never the home entry
    //    (a redirecting home is still the home), never a failed fetch.
    //    Surface what was dropped: a silent drop makes a consolidated
    //    site look unscanned.
    pairs = pairs.filter((p) => {
      if (p.sel.type === "home") return true;
      if (!isReal(p.page)) return true;
      if (sameSite(p.page.finalUrl || p.sel.url)) return true;
      offsiteNotes.push(`${p.sel.url} -> ${p.page.finalUrl}`);
      return false;
    });

    // 2. Dedupe by normalised finalUrl. When several sitemap URLs land
    //    on the same page, keep the more specifically-typed entry
    //    (non-"other" beats "other"), tie-broken by selection order.
    const specificity = (p: Pair) => (p.sel.type !== "other" ? 1 : 0);
    const byKey = new Map<string, Pair>();
    for (const p of pairs) {
      const k = normKey(p.page.finalUrl || p.sel.url);
      const prev = byKey.get(k);
      if (!prev || specificity(p) > specificity(prev)) byKey.set(k, p);
    }
    pairs = pairs.filter(
      (p) => byKey.get(normKey(p.page.finalUrl || p.sel.url)) === p,
    );

    selected = pairs.map((p) => p.sel);
    pages = pairs.map((p) => p.page);
  }

  // If every fetch failed, the site is unreachable from our Worker.
  // Don't pretend to score it; surface a real error.
  const anyOk = pages.some((p) => p.status > 0 && p.status < 400);
  if (!anyOk) {
    const codes = pages.map((p) => p.status).filter(Boolean);
    if (codes.length > 0 && codes.every((c) => c === 429)) {
      throw new Error(
        `Rate-limited by ${baseUrl.host} (HTTP 429) from our scanner's IP. The site is likely still reachable for AI crawlers from other IPs. Try again in a few minutes.`,
      );
    }
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
    // Type from the LANDED url, not the pre-redirect sitemap url, so a
    // page that 301s to /pricing/ is exempt as pricing. A redirecting
    // home stays "home" (isHome is tracked separately, scan.ts; letting
    // them diverge would mistype and wrongly nag a localised homepage).
    const landedType =
      sel.type === "home" ? "home" : classifyUrl(page.finalUrl || sel.url);
    const refinedType = refineType(landedType, page);
    const pageInfo: PageInfo = {
      url: page.finalUrl || sel.url,
      type: refinedType,
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

  // When AI bots are blocked AND the home body is near-empty, the content
  // findings below are almost certainly downstream of the block or a WAF
  // challenge page, not independent authoring mistakes. Prepend one
  // non-scoring note so the report does not read as a list of unrelated
  // errors (M7). We deliberately do NOT suppress the downstream findings
  // from scoring: that would mask genuine gaps if the block is ever lifted.
  if (offsiteNotes.length > 0) {
    allFindings.unshift({
      id: "context.offsite-redirects",
      status: "pass",
      severity: "nice",
      discipline: "both",
      title: `${offsiteNotes.length} sitemap URL${offsiteNotes.length === 1 ? "" : "s"} redirect off-site and ${offsiteNotes.length === 1 ? "was" : "were"} not scored`,
      message:
        `These URLs are in ${baseUrl.host}'s sitemap but 301-redirect to a different site, so their content lives on another property and was excluded from this report: ${offsiteNotes.join("; ")}. Usually fine (docs or blog consolidated elsewhere); only act if you expected this content to live on ${baseUrl.host}.`,
    });
  }

  const homeWordCount = homeIdx >= 0 ? pages[homeIdx]?.wordCount ?? 0 : 0;
  const botsBlocked = allFindings.some((f) => f.id === "robots.ai-bots-blocked" && f.status === "fail");
  if (botsBlocked && homeWordCount < 50) {
    allFindings.unshift({
      id: "context.blocked-cascade",
      status: "pass",
      severity: "nice",
      discipline: "ai-seo",
      title: "Content findings below are likely a consequence of the bot block / WAF",
      message:
        `This site blocks AI crawlers (or served our scanner a challenge page), so the page body we received is near-empty. The content, schema, and structure findings below are most likely downstream of that block rather than separate authoring mistakes. Fix the crawler access first, then re-scan to see the real content picture.`,
    });
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
