// Post-deploy smoke test: hits the LIVE deployment and proves the
// pieces that have silently broken before (KV binding, env secrets,
// function routing) are alive. Read-only by design: it never runs a
// real scan and consumes no rate-limit budget (both probe POSTs are
// rejected before the A2/A3 counters run).
//
// Usage:
//   node tests/smoke-live.mjs                      # production (full checks)
//   node tests/smoke-live.mjs https://x.pages.dev  # preview (relaxed checks)
//
// On this Windows machine Node needs the system CA store:
//   NODE_OPTIONS=--use-system-ca
//
// Production-only expectations (skipped for any other base URL):
//  - /api/stats counters > 0 (zero means the SHARES KV binding is lost)
//  - POST /api/scan without a token is 403 (Turnstile gate still armed;
//    on preview Turnstile may be unset and the call would run a real scan)

const base = (process.argv[2] || "https://xeoscan.ai").replace(/\/+$/, "");
const isProd = base === "https://xeoscan.ai";

const probs = [];
const ok = (cond, msg) => {
  if (!cond) probs.push(msg);
  console.log(`${cond ? "  ok " : "  FAIL"} ${msg}`);
};

// One transient network blip must not fail the deploy check.
async function req(path, init) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(base + path, { redirect: "manual", ...init });
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  throw lastErr;
}

console.log(`Smoke test against ${base} (${isProd ? "production" : "preview"} expectations)`);

// 1. Homepage serves, looks like ours, and the security headers are on.
{
  const r = await req("/");
  const body = await r.text();
  ok(r.status === 200, `GET / is 200 (got ${r.status})`);
  ok(body.includes("XEOscan"), "homepage contains XEOscan");
  ok(!!r.headers.get("content-security-policy-report-only"), "CSP-Report-Only header present");
  ok(r.headers.get("x-frame-options") === "DENY", "X-Frame-Options present");
}

// 2. /api/config: the function layer is routing and returns JSON.
{
  const r = await req("/api/config");
  ok(r.status === 200, `GET /api/config is 200 (got ${r.status})`);
  try {
    JSON.parse(await r.text());
    ok(true, "config is valid JSON");
  } catch {
    ok(false, "config is valid JSON");
  }
}

// 3. /api/stats: reads the SHARES KV binding. Zeros on production mean
// the binding is unbound again (the exact regression of 2026-05-18).
{
  const r = await req("/api/stats");
  ok(r.status === 200, `GET /api/stats is 200 (got ${r.status})`);
  let stats = null;
  try { stats = JSON.parse(await r.text()); } catch {}
  ok(stats && Number.isFinite(stats.scans) && Number.isFinite(stats.pages), "stats has numeric scans/pages");
  if (isProd) ok(stats && stats.scans > 0, `stats.scans > 0, SHARES KV bound (got ${stats?.scans})`);
}

// 4. Share-link route: unknown id must 404 (function + KV read path).
{
  const r = await req("/api/r/zzzzzzzzzzzz");
  ok(r.status === 404, `GET /api/r/<unknown> is 404 (got ${r.status})`);
}

// 5. Scan endpoint deployed with the SSRF guard live. This rejects
// BEFORE Turnstile and the rate limits, so it costs nothing.
{
  const r = await req("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1/" }),
  });
  let data = null;
  try { data = JSON.parse(await r.text()); } catch {}
  ok(r.status === 400 && data?.error === "blocked_host", `POST /api/scan private IP is 400 blocked_host (got ${r.status} ${data?.error})`);
}

// 6. Turnstile gate armed (production only): a token-less scan of a
// public URL must be rejected 403. A 200 here means TURNSTILE_SECRET
// is gone and the gate is silently open.
if (isProd) {
  const r = await req("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  ok(r.status === 403, `POST /api/scan without token is 403, Turnstile armed (got ${r.status})`);
}

if (probs.length === 0) {
  console.log("SMOKE PASS");
  process.exit(0);
} else {
  console.log(`SMOKE FAIL (${probs.length})`);
  process.exit(1);
}
