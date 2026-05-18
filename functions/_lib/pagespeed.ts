import type { PageSpeedMetrics } from "./types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function fetchPageSpeed(
  url: string,
  apiKey: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<PageSpeedMetrics> {
  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy,
    category: "performance",
  });

  const controller = new AbortController();
  // Mobile Lighthouse (throttled CPU/network) regularly runs longer than
  // desktop; 22s aborted mobile mid-audit while desktop on the same scan
  // succeeded. 35s clears the slow-mobile case. Callers run the two
  // strategies in parallel so this ceiling does not add wall-clock time.
  const timer = setTimeout(() => controller.abort(), 35000);
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
    return {
      lcp: audits["largest-contentful-paint"]?.numericValue ?? null,
      inp: audits["interaction-to-next-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      performanceScore: perfScore,
      fetched: true,
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
