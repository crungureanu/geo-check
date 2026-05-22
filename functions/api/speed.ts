import { fetchPageSpeed } from "../_lib/pagespeed";
import { cwvFinding } from "../_lib/checks/classic-seo";
import { computeScores, sortFindings, computeNotApplicable } from "../_lib/scoring";
import { getScan, updateScan, logSpeedScores } from "../_lib/kv";
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
  let body: { id?: string; report?: ScanResult };
  try {
    body = (await request.json()) as { id?: string; report?: ScanResult };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const id = body.id?.trim();
  const posted = body.report;
  // Two modes:
  //  - stored:    {id}      -> load from KV, merge, persist in place.
  //  - stateless: {report}  -> the client still holds the report (no KV
  //               binding, or KV save failed at scan time, so it never
  //               got an id). We merge into the posted copy and return
  //               it; nothing is persisted. Keeps the speed button
  //               working everywhere instead of silently disappearing.
  if (!id && !posted) {
    return json({ error: "id or report is required" }, 400);
  }

  if (!env.PAGESPEED_API_KEY) {
    return json(
      { error: "unavailable", message: "Speed testing is not available right now." },
      503,
    );
  }
  if (id && !env.SHARES) {
    return json(
      { error: "unavailable", message: "Speed testing needs report storage, which is unavailable." },
      503,
    );
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || undefined;

  // Same per-IP burst and global daily limits as a scan: the PageSpeed call
  // spends Google API quota and a subrequest, so it must be bounded. In
  // stateless mode there is no stored-id gate, so this rate limit is the
  // primary backstop against the endpoint being hammered cold.
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

  let report: ScanResult | null = null;
  if (id) {
    report = await getScan(env.SHARES, id);
    if (!report) {
      return json(
        { error: "not_found", message: "That report was not found or has expired (links live for 7 days)." },
        404,
      );
    }
  } else if (
    posted &&
    typeof posted.url === "string" &&
    Array.isArray(posted.findings) &&
    posted.findings.every(
      (f: any) => f && typeof f.id === "string" && typeof f.status === "string",
    )
  ) {
    // Trust the posted report only as far as we use it: the URL to test
    // and the findings/pages to re-merge and re-score. It is never
    // persisted in this mode, so a tampered body only affects the
    // response the same client gets back.
    report = posted;
  } else {
    return json({ error: "invalid_report", message: "The report data was missing or malformed." }, 400);
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

  // Merge: drop any prior seo.cwv (so re-runs are idempotent), add the
  // fresh one, re-sort, recompute the scores and the not-applicable list,
  // and attach the raw numbers for the gauges. The stored findings are
  // already deduped (one per base id, no ':' suffix), so re-running dedupe
  // would be a no-op; we skip it as unnecessary work and operate directly.
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

  // Persist only in stored mode (we have an id and KV). In stateless
  // mode there is nothing to write back to; the client keeps the
  // returned copy and any share link it already had is unaffected.
  if (id && env.SHARES) {
    await updateScan(env.SHARES, id, updated);
    // Separate 90-day speed log so the admin "Websites scanned" view
    // can show Mobile/Desktop scores after the 7-day share has expired.
    // Fail-soft: a logging blip must not break the user-facing response.
    try {
      await logSpeedScores(env.SHARES, id, {
        mobile: mobile?.performanceScore ?? null,
        desktop: desktop?.performanceScore ?? null,
      });
    } catch {}
  }
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
