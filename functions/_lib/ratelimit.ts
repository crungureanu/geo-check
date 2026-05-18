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

// 1000/day chosen by the owner as the backstop ceiling. Overridable
// at runtime via SCAN_DAILY_CAP (Pages env var, no redeploy). Safe to
// raise further once Turnstile (A4) is gating bots.
export const DEFAULT_DAILY_CAP = 1000;

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

// A2 (code-side): per-IP short-window rate limit. The originally
// planned Cloudflare WAF rate-limit rule only works on a custom-domain
// zone; the tool currently serves from *.pages.dev (Cloudflare's zone,
// not ours), so the WAF rule is unavailable until the domain is
// connected. This KV-backed limiter works on pages.dev today, survives
// the domain move unchanged, and shares the daily cap's safety design:
// fail OPEN on missing/erroring KV or a missing client IP (never block
// a real user because the counter or IP header hiccuped). It stops one
// actor hammering Scan; Turnstile (A4) already blocks non-browsers.
//
// Fixed-window counter: key = iprate:<ip>:<windowIndex>. KV has no
// atomic increment so concurrent bursts undercount, which (as with the
// daily cap) only ever errs toward allowing, never toward over-blocking.

export const DEFAULT_IP_PER_MIN = 5;
const IP_WINDOW_SECONDS = 60;

export interface IpRateResult {
  allowed: boolean;
  count: number;
  limit: number;
}

export function resolveIpPerMin(override: string | undefined): number {
  const n = Number(override);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IP_PER_MIN;
}

export async function consumeIpRate(
  kv: KVNamespace | undefined,
  ip: string | undefined,
  limit: number,
  now: Date = new Date(),
): Promise<IpRateResult> {
  // No store, or no identifiable client IP => cannot enforce safely =>
  // fail open. Never block on missing infrastructure.
  if (!kv || !ip) return { allowed: true, count: 0, limit };

  const windowIndex = Math.floor(now.getTime() / 1000 / IP_WINDOW_SECONDS);
  const key = `iprate:${ip}:${windowIndex}`;
  try {
    const raw = await kv.get(key);
    const n = raw ? parseInt(raw, 10) : 0;
    const current = Number.isFinite(n) && n >= 0 ? n : 0;

    if (current >= limit) {
      return { allowed: false, count: current, limit };
    }

    const next = current + 1;
    // TTL just past the window so the key self-evicts; no day-long keys.
    await kv.put(key, String(next), {
      expirationTtl: IP_WINDOW_SECONDS * 2,
    });
    return { allowed: true, count: next, limit };
  } catch {
    // KV threw: fail open, same rationale as the daily cap.
    return { allowed: true, count: 0, limit };
  }
}
