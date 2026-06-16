import type { MinedAudit, PageSpeedMetrics } from "./types";
import { MINED_AUDIT_IDS } from "./checks/lighthouse";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function fetchPageSpeed(
  url: string,
  apiKey: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<PageSpeedMetrics> {
  const params = new URLSearchParams({ url, key: apiKey, strategy });
  // performance drives the Speed score (CWV); seo + best-practices are mined
  // for the Wave 2a Lighthouse notes. Same call, same quota: PSI bills per
  // request, not per category. It does run more audits server-side, so the
  // call is a little slower (watched against the 50s abort below).
  params.append("category", "performance");
  params.append("category", "seo");
  params.append("category", "best-practices");

  const controller = new AbortController();
  // PSI runs a full Lighthouse audit server-side; for heavy sites it can
  // take well over half a minute (gonvarri.com timed out both strategies
  // at 35s). 50s clears almost all real sites. The await is I/O, not
  // CPU, so it does not hit the Worker CPU limit, and callers run mobile
  // and desktop in parallel so this ceiling does not stack.
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        lcp: null,
        inp: null,
        cls: null,
        performanceScore: null,
        fetched: false,
        error: `PSI returned ${res.status}`,
      };
    }
    const data: any = await res.json();
    const audits = data?.lighthouseResult?.audits ?? {};
    const perfScore = data?.lighthouseResult?.categories?.performance?.score ?? null;
    // Pull only the narrow keep-list of mined audits, so stored reports do not
    // balloon with the full ~50-audit payload.
    let mined: Record<string, MinedAudit> | undefined;
    for (const id of MINED_AUDIT_IDS) {
      const a = audits[id];
      if (!a) continue;
      (mined ??= {})[id] = {
        score: typeof a.score === "number" ? a.score : null,
        scoreDisplayMode: typeof a.scoreDisplayMode === "string" ? a.scoreDisplayMode : "",
        title: typeof a.title === "string" ? a.title : id,
        ...(typeof a.displayValue === "string" ? { displayValue: a.displayValue } : {}),
      };
    }
    return {
      lcp: audits["largest-contentful-paint"]?.numericValue ?? null,
      inp: audits["interaction-to-next-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      performanceScore: perfScore,
      fetched: true,
      ...(mined ? { audits: mined } : {}),
    };
  } catch (err: any) {
    return {
      lcp: null,
      inp: null,
      cls: null,
      performanceScore: null,
      fetched: false,
      error: err?.name === "AbortError" ? "timeout" : (err?.message ?? "PSI failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}
