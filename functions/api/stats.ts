import { readTotalCounters, seedTotalCountersFromLog } from "../_lib/kv";

interface Env {
  SHARES?: KVNamespace;
}

// Public, read-only social-proof endpoint: "we have scanned N
// websites and M pages so far". Backed by two no-TTL KV counters
// bumped from /api/scan; lazy-seeded from the 90-day scan log on the
// very first hit after deploy so the homepage immediately shows the
// existing history without a manual seed step.
//
// Heavily cached at the edge (5 minutes) so a spike of homepage views
// translates to at most one KV read every 5 minutes. KV is cheap, but
// the homepage hits this on every render and the numbers do not need
// to be second-fresh.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const respond = (scans: number, pages: number) =>
    new Response(JSON.stringify({ scans, pages }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });

  if (!env.SHARES) return respond(0, 0);

  let c = await readTotalCounters(env.SHARES);
  // Both still zero AFTER deploy almost certainly means we have never
  // seeded, so fold the existing 90-day scan log in. Idempotent: once
  // seeded, subsequent calls skip the list() and just read the two
  // integers.
  if (c.scans === 0 && c.pages === 0) {
    c = await seedTotalCountersFromLog(env.SHARES);
  }
  return respond(c.scans, c.pages);
};
