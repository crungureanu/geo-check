import { fetchPageSpeed } from "../_lib/pagespeed";
import { cwvFinding } from "../_lib/checks/classic-seo";
import { computeScores, sortFindings, computeNotApplicable } from "../_lib/scoring";
import { getScan, updateScan } from "../_lib/kv";
import {
  consumeDailyCap,
  resolveDailyCap,
  consumeIpRate,
  resolveIpPerMin,
} from "../_lib/ratelimit";
import type { ScanResult } from "../_lib/types";

interface Env {
  PAGESPEED_API_KEY?: string;
  SCAN_DAILY_CAP?: string;
  SCAN_IP_PER_MIN?: string;
  SHARES?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Phase 2 of the scan: the slow Google PageSpeed (Lighthouse) call, run only
// when the user clicks "Run speed test" on a report they already have. It
// loads that stored report, fetches Core Web Vitals, merges the seo.cwv
// signal in, recomputes the scores, and persists the report in place so the
// share link reflects it too. Kept off the default scan so the common path
// stays fast.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const id = body.id?.trim();
  if (!id) return json({ error: "id is required" }, 400);

  if (!env.PAGESPEED_API_KEY) {
    return json(
      { error: "unavailable", message: "Speed testing is not available right now." },
      503,
    );
  }
  if (!env.SHARES) {
    return json(
      { error: "unavailable", message: "Speed testing needs report storage, which is unavailable." },
      503,
    );
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || undefined;

  // Same per-IP burst and global daily limits as a scan: the PageSpeed call
  // spends Google API quota and a subrequest, so it must be bounded. The
  // requirement that `id` reference an existing stored report already means
  // this can only ever refine a real prior scan, not be called cold.
  const ipRate = await consumeIpRate(
    env.SHARES,
    clientIp,
    resolveIpPerMin(env.SCAN_IP_PER_MIN),
  );
  if (!ipRate.allowed) {
    return json(
      { error: "rate_limited", message: "You are going too fast. Wait a minute, then try again." },
      429,
    );
  }
  const cap = await consumeDailyCap(env.SHARES, resolveDailyCap(env.SCAN_DAILY_CAP));
  if (!cap.allowed) {
    return json(
      { error: "rate_limited", message: "The daily limit for this free tool has been reached. Try again tomorrow." },
      429,
    );
  }

  const report = await getScan(env.SHARES, id);
  if (!report) {
    return json(
      { error: "not_found", message: "That report was not found or has expired (links live for 7 days)." },
      404,
    );
  }

  // Speed is measured on the home page (what classicSeoChecks used).
  const homePage =
    report.scannedPages?.find((p) => p.type === "home") ?? report.scannedPages?.[0];
  const target = homePage?.url || report.url;

  let mobile = null;
  let desktop = null;
  try {
    [mobile, desktop] = await Promise.all([
      fetchPageSpeed(target, env.PAGESPEED_API_KEY, "mobile").catch(() => null),
      fetchPageSpeed(target, env.PAGESPEED_API_KEY, "desktop").catch(() => null),
    ]);
  } catch {
    /* fall through to the unusable-result check below */
  }

  const finding = mobile ? cwvFinding(mobile) : null;
  if (!finding) {
    return json(
      {
        error: "speed_failed",
        message:
          "The PageSpeed test did not return usable data (the site or Google's test was too slow). The rest of your report is unaffected; try again later.",
      },
      502,
    );
  }

  // Merge: drop any prior seo.cwv (idempotent re-runs), add the fresh one,
  // re-sort, recompute the scores and the not-applicable list, and attach
  // the raw numbers for the gauges. The stored findings are already deduped,
  // so we operate on them directly (no re-dedupe, which would strip the
  // aggregated affectedPages on per-page findings).
  const findings = report.findings.filter((f) => f.id !== "seo.cwv");
  findings.push(finding);
  const sorted = sortFindings(findings);

  const updated: ScanResult = {
    ...report,
    findings: sorted,
    scores: computeScores(sorted),
    notApplicable: computeNotApplicable(sorted),
    performance: { mobile: mobile ?? null, desktop: desktop ?? null },
  };

  await updateScan(env.SHARES, id, updated);
  return json({ ok: true, result: updated });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
