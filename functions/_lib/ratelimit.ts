// A3: global daily scan cap. A coarse abuse ceiling so a single actor
// (or a viral spike) cannot run the free tool's cost unbounded. This is
// the code-side complement to A1 (per-scan subrequest budget) and A2
// (per-IP rate limit, configured at the Cloudflare edge).
//
// Deliberate design properties:
//
// 1. FAIL OPEN. If the KV store is absent (local/test, or the binding
//    is unset) or throws, scans are ALLOWED. The dangerous failure mode
//    is blocking real users because the counter store hiccuped; an
//    abuse cap that occasionally lets a few extra scans through is
//    fine, a tool that 429s everyone because KV blipped is not.
//
// 2. Counts the ATTEMPT, before the expensive scan. A scan that then
//    fails still consumed real work, so it still counts. A request
//    rejected earlier (bad JSON / bad URL) never reaches here, so it
//    never consumes the cap.
//
// 3. KV has no atomic increment and is eventually consistent, so a
//    read-modify-write counter undercounts under concurrency (lost
//    updates). That is the SAFE direction: undercount means the true
//    ceiling is roughly cap + concurrency-slop, never below cap, so it
//    can never over-block. Precise accounting is not the goal; bounding
//    runaway volume is.
//
// 4. Lives entirely in the request handler, never inside performScan.
//    performScan is the offline harness boundary and must stay pure
//    (network only via fetch); KV must not leak into it.

export const DEFAULT_DAILY_CAP = 500;

// A 2-day TTL on each day's key so stale counters self-evict and the
// namespace never grows unbounded.
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

export interface DailyCapResult {
  allowed: boolean;
  count: number; // best-effort count AFTER this attempt (or the seen count when capped)
  cap: number;
}

function dayKey(now: Date): string {
  // UTC day boundary, stable regardless of the worker's locale.
  return `scancap:${now.toISOString().slice(0, 10)}`;
}

// Resolve the effective cap from an optional env override (string, so
// it can be retuned via a Pages env var without a redeploy, mirroring
// A1's SCAN_SUBREQUEST_BUDGET). Falls back to DEFAULT_DAILY_CAP for
// missing / non-positive / non-numeric values.
export function resolveDailyCap(override: string | undefined): number {
  const n = Number(override);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

export async function consumeDailyCap(
  kv: KVNamespace | undefined,
  cap: number,
  now: Date = new Date(),
): Promise<DailyCapResult> {
  // No store => cannot enforce => fail open. Never block on missing KV.
  if (!kv) return { allowed: true, count: 0, cap };

  const key = dayKey(now);
  try {
    const raw = await kv.get(key);
    const n = raw ? parseInt(raw, 10) : 0;
    const current = Number.isFinite(n) && n >= 0 ? n : 0;

    if (current >= cap) {
      return { allowed: false, count: current, cap };
    }

    const next = current + 1;
    await kv.put(key, String(next), { expirationTtl: KEY_TTL_SECONDS });
    return { allowed: true, count: next, cap };
  } catch {
    // KV unavailable / threw: fail open. The product must not break
    // because the abuse counter did.
    return { allowed: true, count: 0, cap };
  }
}
