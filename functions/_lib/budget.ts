// Per-scan subrequest budget (A1). Cloudflare Pages Functions cap the
// number of outbound subrequests per request. One scan fans out to root
// files + child sitemaps + up to 10 pages, each up to MAX_REDIRECTS +
// meta-refresh subrequests, so an unbounded scan of a large or
// redirect-heavy site exceeds the cap and the runtime aborts mid-scan,
// which surfaced as a false "Could not reach". This bounds the page
// phase and lets scan.ts truncate gracefully instead of failing. It is
// also the lever against volume abuse of the public endpoint.
//
// NOTE: the exact Cloudflare subrequest cap is NOT verified in-repo and
// must be re-checked against current Cloudflare docs. The DESIGN is
// correct for any cap; only this constant changes. Kept conservative,
// with headroom for the unbudgeted discovery phase (robots/llms/
// favicon/sitemap in fetchRootFiles, itself bounded by MAX_REDIRECTS).
export const SCAN_SUBREQUEST_BUDGET = 40;

// MUST be a per-scan instance passed by argument. Workers share module
// scope across requests on an isolate, so a module-global counter would
// cross-contaminate concurrent scans.
export class ResourceBudget {
  private remaining: number;
  constructor(total: number = SCAN_SUBREQUEST_BUDGET) {
    this.remaining = total;
  }
  // MUST stay synchronous and await-free. The page and child-sitemap
  // fan-outs are Promise.all; check-then-decrement is atomic ONLY
  // because nothing yields between them on the single-threaded event
  // loop. Making this async (or awaiting inside) reintroduces a race.
  tryConsume(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }
  get left(): number {
    return this.remaining;
  }
}
