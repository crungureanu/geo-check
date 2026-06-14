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
import { contentDepthChecks } from "../_lib/checks/content-depth";
import { computeScores, dedupeFindings, sortFindings, computeNotApplicable, computeContentScore } from "../_lib/scoring";
import { saveScan, logScan, bumpTotalCounters, getConnection } from "../_lib/kv";
import { generateDeepLinks } from "../_lib/deep-links";
import { ResourceBudget } from "../_lib/budget";
import {
  consumeDailyCap,
  resolveDailyCap,
  consumeIpRate,
  resolveIpPerMin,
} from "../_lib/ratelimit";
import { verifyTurnstile } from "../_lib/turnstile";
import { blockedHostReason } from "../_lib/ssrf";
import type { CheckContext, Finding, PageInfo, ScanResult } from "../_lib/types";

interface Env {
  PAGESPEED_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  // A1: subrequest ceiling, overridable via a Pages env var so the cap
  // can be retuned without a redeploy (and exercised by the harness).
  SCAN_SUBREQUEST_BUDGET?: string;
  // A3: global daily scan cap, overridable via a Pages env var so the
  // ceiling can be retuned without a redeploy (same rationale as
  // SCAN_SUBREQUEST_BUDGET). Default in ratelimit.ts.
  SCAN_DAILY_CAP?: string;
  // A2: per-IP scans/minute, overridable via a Pages env var without a
  // redeploy. Default in ratelimit.ts.
  SCAN_IP_PER_MIN?: string;
  SHARES?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Deliberate, user-facing, secret-free scan errors. Only these are
// echoed to the client (A5); any other thrown error is generic'd so an
// unexpected failure (e.g. a future external API call) cannot leak a
// URL bearing a ?key= credential.
class ScanError extends Error {}

// Belt-and-braces: strip credential query values from any string that
// does reach the client, even a ScanError (defence in depth).
function redactSecrets(s: string): string {
  return s.replace(
    /([?&](?:key|api[_-]?key|token|secret|password|access[_-]?token)=)[^&\s"']+/gi,
    "$1[redacted]",
  );
}

// Exported for the offline fixture harness (tests/). Cloudflare Pages
// only invokes the onRequest* handlers; an extra export is inert there.
export async function performScan(
  targetUrl: string,
  env: Env,
  opts: { pageSpeed?: boolean; now?: number } = {},
): Promise<ScanResult> {
  const startedAt = Date.now();
  // "now" for time-dependent checks (freshness/recency). Injectable so the
  // offline harness can freeze it and keep goldens stable year to year.
  const now = opts.now ?? Date.now();
  const baseUrl = new URL(targetUrl);
  const origin = baseUrl.origin;

  // A1: one per-scan subrequest budget, passed by argument only (never
  // module-global: Workers share module scope across requests). Bounds
  // the child-sitemap + page fan-out so a large/redirect-heavy site (or
  // an abuser) cannot exceed the Cloudflare subrequest cap and abort
  // the scan. Discovery (fetchRootFiles) is unbudgeted by design (no
  // seam) but bounded by MAX_REDIRECTS.
  const budgetOverride = Number(env.SCAN_SUBREQUEST_BUDGET);
  const budget = new ResourceBudget(
    Number.isFinite(budgetOverride) && budgetOverride > 0 ? budgetOverride : undefined,
  );

  const rootFiles = await fetchRootFiles(origin);
  const sitemapUrls = await expandSitemap(rootFiles.sitemap, origin, budget);

  let selected: Array<{ url: string; type: ReturnType<typeof classifyUrl> }>;
  if (sitemapUrls.length > 0) {
    selected = selectPages(sitemapUrls, targetUrl, origin, 10);
  } else {
    selected = [{ url: targetUrl, type: classifyUrl(targetUrl) }];
    if (classifyUrl(targetUrl) !== "home") {
      selected.unshift({ url: `${origin}/`, type: "home" });
    }
  }

  // Fetch the home page FIRST and await it, so the budget can never be
  // starved before home is fetched (A1). Home gates anyOk, the isHome
  // checks, PageSpeed and the blocked-cascade note; if it were the
  // skipped one a reachable site could be misreported as down.
  const homeSelIdx = selected.findIndex((s) => s.type === "home");
  const homeDoc =
    homeSelIdx >= 0
      ? await fetchDoc(selected[homeSelIdx].url, { timeoutMs: 8000, budget })
      : null;
  const fetched = await Promise.all(
    selected.map((s, i) =>
      i === homeSelIdx && homeDoc
        ? homeDoc
        : fetchDoc(s.url, { timeoutMs: 8000, budget }),
    ),
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

  // A1: drop pages the subrequest budget skipped. Runs AFTER the B15
  // reconciliation and BEFORE the anyOk guard / findings loop, keeping
  // selected+pages index-parallel. This is what prevents a partially
  // truncated large site from (a) being misreported as unreachable by
  // anyOk and (b) emitting phantom status-0 fetch.failed findings. Home
  // was fetched first under guaranteed budget so it is never skipped.
  let truncated = 0;
  {
    const keep: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].fetchError === "budget-exhausted") truncated++;
      else keep.push(i);
    }
    if (truncated > 0) {
      selected = keep.map((i) => selected[i]);
      pages = keep.map((i) => pages[i]);
    }
  }

  // If every fetch failed, the site is unreachable from our Worker.
  // Don't pretend to score it; surface a real error.
  const anyOk = pages.some((p) => p.status > 0 && p.status < 400);
  if (!anyOk) {
    const codes = pages.map((p) => p.status).filter(Boolean);
    if (codes.length > 0 && codes.every((c) => c === 429)) {
      throw new ScanError(
        `Rate-limited by ${baseUrl.host} (HTTP 429) from our scanner's IP. The site is likely still reachable for AI crawlers from other IPs. Try again in a few minutes.`,
      );
    }
    const statuses = pages.map((p) => (p.status ? String(p.status) : "no response")).join(", ");
    throw new ScanError(
      `Could not reach ${baseUrl.host}. Every page fetch failed (status: ${statuses}). Common causes: SSL/TLS misconfiguration on the site, a WAF blocking unknown crawlers, or the site is offline. Open ${baseUrl.href} in a browser to confirm it loads.`,
    );
  }

  const homeIdx = selected.findIndex((s) => s.type === "home");
  // A1: PageSpeed is one more subrequest (raw fetch to googleapis, not
  // via fetchDoc) so it is budgeted here at the call site. It is
  // already optional/try-catch'd, so skipping it on exhaustion is safe.
  // PageSpeed is opt-in (phase 2): the slow Lighthouse call (20-40s) is
  // skipped on the default scan and run later via /api/speed only if the
  // user asks. opts.pageSpeed lets the dedicated endpoint reuse this path.
  if (opts.pageSpeed && homeIdx >= 0 && env.PAGESPEED_API_KEY && budget.tryConsume()) {
    const psUrl = pages[homeIdx].finalUrl;
    // Desktop is a second PSI subrequest, budgeted independently so a
    // tight budget keeps mobile (which drives the score) and just drops
    // desktop. Both are optional/try-catch'd. Run them in PARALLEL: the
    // PSI timeout was raised to 35s for slow mobile Lighthouse, and
    // awaiting them sequentially would otherwise ~double wall-clock time.
    const wantDesktop = budget.tryConsume();
    const [mobileRes, desktopRes] = await Promise.all([
      fetchPageSpeed(psUrl, env.PAGESPEED_API_KEY, "mobile").catch(() => null),
      wantDesktop
        ? fetchPageSpeed(psUrl, env.PAGESPEED_API_KEY, "desktop").catch(() => null)
        : Promise.resolve(null),
    ]);
    pages[homeIdx].pagespeed = mobileRes;
    if (wantDesktop) pages[homeIdx].pagespeedDesktop = desktopRes;
  }

  const allFindings: Finding[] = [];
  // Bar-3 (Content depth) findings: computed on every scan (same pages,
  // zero extra fetches), stored in full, but stripped from API responses
  // until the email unlock. Kept out of allFindings so they never touch
  // the aiSeo/classicSeo scores.
  const contentAll: Finding[] = [];
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
      now,
    };

    allFindings.push(...robotsChecks(ctx));
    allFindings.push(...discoveryChecks(ctx));
    allFindings.push(...schemaChecks(ctx));
    allFindings.push(...extractabilityChecks(ctx));
    allFindings.push(...citabilityChecks(ctx));
    allFindings.push(...answerShapeChecks(ctx));
    allFindings.push(...classicSeoChecks(ctx));
    allFindings.push(...extrasChecks(ctx));
    contentAll.push(...contentDepthChecks(ctx));
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

  // A1: tell the user we deliberately capped the scan, so a truncated
  // large site does not look like a broken or partial report. status
  // "pass" => zero score impact (scoring.ts skips pass); colon-free id
  // => its own dedupe group, never merged.
  if (truncated > 0) {
    allFindings.unshift({
      id: "context.pages-truncated",
      status: "pass",
      severity: "nice",
      discipline: "both",
      title: `Scan limited to ${pages.length} page${pages.length === 1 ? "" : "s"} to stay within request limits`,
      message:
        `This site is large or redirect-heavy, so ${truncated} further page${truncated === 1 ? "" : "s"} ${truncated === 1 ? "was" : "were"} not fetched to keep the scan within our per-scan request budget. The pages shown were fully scored. Re-run later, or scan a specific URL, to cover the rest.`,
    });
  }

  const homeWordCount = homeIdx >= 0 ? pages[homeIdx]?.wordCount ?? 0 : 0;
  const botsBlocked = allFindings.some(
    (f) => f.id === "robots.ai-access" && f.status === "fail",
  );
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
  const notApplicable = computeNotApplicable(deduped);
  const deepLinks = generateDeepLinks(baseUrl.host);

  const result: ScanResult = {
    url: targetUrl,
    scannedPages: pageInfos,
    scores,
    findings: sorted,
    notApplicable,
    deepLinks,
    scannedAt: new Date(startedAt).toISOString(),
    ttl: 7 * 24 * 60 * 60,
  };

  // Bar 3: attach only when at least one content signal applied, so the
  // shape stays byte-identical for scans where nothing was assessable.
  const cDeduped = dedupeFindings(contentAll);
  const contentScore = computeContentScore(cDeduped);
  if (contentScore !== null) {
    result.scores.content = contentScore;
    result.contentFindings = sortFindings(cDeduped);
  }

  // Expose the raw PageSpeed numbers for the dashboard gauges/meters,
  // but ONLY when they exist (production with a key). Omitted entirely
  // otherwise so the offline harness JSON is byte-identical.
  const ps = homeIdx >= 0 ? pages[homeIdx] : null;
  if (ps && (ps.pagespeed || ps.pagespeedDesktop)) {
    result.performance = {
      mobile: ps.pagespeed ?? null,
      desktop: ps.pagespeedDesktop ?? null,
    };
  }

  return result;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { url?: string; turnstileToken?: string; ct?: string };
  try {
    body = (await request.json()) as { url?: string; turnstileToken?: string; ct?: string };
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

  // SSRF guard: refuse loopback/private/link-local/reserved targets up
  // front with a clear message. fetcher.ts re-checks every redirect hop.
  if (blockedHostReason(parsed.hostname)) {
    return json(
      {
        error: "blocked_host",
        message:
          "This address points to a private or internal network, so it cannot be scanned. Enter a public website address.",
      },
      400,
    );
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || undefined;

  // A4: Turnstile human/bot gate. Runs BEFORE the A3 cap so a blocked
  // bot consumes neither the daily budget nor a KV write. Inert until
  // TURNSTILE_SECRET is set (verifyTurnstile then skips, fail-open), so
  // shipping this changes nothing until the widget exists.
  const ts = await verifyTurnstile(
    env.TURNSTILE_SECRET,
    body.turnstileToken,
    clientIp,
  );
  if (!ts.ok) {
    return json(
      {
        error: "verification_failed",
        message:
          "Could not verify you are human. Refresh the page and try the scan again.",
      },
      403,
    );
  }

  // A2: per-IP short-window rate limit. After Turnstile (so it only
  // ever counts human traffic) and before the A3 global cap (so one
  // actor's burst cannot eat the shared daily budget). Fails open on
  // missing KV / missing IP. Code-side because the WAF-rule form needs
  // a custom-domain zone the *.pages.dev host does not have.
  const ipRate = await consumeIpRate(
    env.SHARES,
    clientIp,
    resolveIpPerMin(env.SCAN_IP_PER_MIN),
  );
  if (!ipRate.allowed) {
    return json(
      {
        error: "rate_limited",
        message:
          "You are scanning too fast. Wait a minute, then try again.",
      },
      429,
    );
  }

  // A3: enforce the global daily cap BEFORE the expensive scan. Counts
  // the attempt; fails open if KV is absent/erroring (never block real
  // users because the abuse counter hiccuped).
  const cap = await consumeDailyCap(
    env.SHARES,
    resolveDailyCap(env.SCAN_DAILY_CAP),
  );
  if (!cap.allowed) {
    return json(
      {
        error: "rate_limited",
        message:
          "This free tool has reached its daily scan limit. Please try again tomorrow.",
      },
      429,
    );
  }

  try {
    const result = await performScan(parsed.toString(), env);
    const id = await saveScan(env.SHARES, result);
    // Operator audit trail. Fail-soft: never let a logging error break
    // a completed scan the user is waiting on.
    try {
      await logScan(env.SHARES, {
        url: result.url,
        at: result.scannedAt,
        pages: result.scannedPages.length,
        ai: result.scores.aiSeo,
        classic: result.scores.classicSeo,
        // Join key for the phase-2 speed log (speedlog:${id}). Null when
        // KV save failed (stateless mode): admin then shows dashes for
        // speed, which is correct since there is no speed-log to write.
        id: id ?? undefined,
      });
    } catch {}
    // Bump the lifetime totals for the homepage social-proof line.
    // Same fail-soft contract as logScan: never let a counter blip
    // break a completed scan the user is waiting on.
    try {
      await bumpTotalCounters(env.SHARES, result.scannedPages.length);
    } catch {}
    // Email-unlock gate: the stored report keeps the bar-3 content data;
    // the response only includes it for a verified connection token
    // (body.ct, the browser's stored copy). Strip otherwise so the
    // locked card cannot be bypassed by reading the network response.
    let unlocked = false;
    try {
      unlocked = Boolean(await getConnection(env.SHARES, body.ct));
    } catch {}
    if (unlocked) {
      return json({ ok: true, unlocked: true, result: id ? { ...result, id } : result });
    }
    const { contentFindings: _cf, ...pub } = result;
    const pubScores = { ...result.scores };
    delete (pubScores as any).content;
    const out: typeof result = { ...pub, scores: pubScores } as any;
    return json({ ok: true, result: id ? { ...out, id } : out });
  } catch (err: any) {
    // A5: never echo arbitrary error text. Only our deliberate,
    // secret-free ScanError is user-facing; anything else is generic so
    // an unexpected failure cannot leak a credentialed URL. Full detail
    // goes to the server log (Cloudflare tail) only.
    console.error("scan_failed", err?.stack || err?.message || String(err));
    const safe =
      err instanceof ScanError
        ? redactSecrets(err.message)
        : "Scan failed due to an unexpected error. Please try again, or try a different URL.";
    return json({ error: "scan_failed", message: safe }, 500);
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
