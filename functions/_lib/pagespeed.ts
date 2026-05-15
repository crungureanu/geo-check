import type { PageSpeedMetrics } from "./types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function fetchPageSpeed(
  url: string,
  apiKey: string,
): Promise<PageSpeedMetrics> {
  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy: "mobile",
    category: "performance",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
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
