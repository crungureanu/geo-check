// A4 Turnstile gate: pure-logic test with a mock siteverify fetch
// (the live path needs a real widget + secret in the dashboard).
// Asserts: inert when no secret (skipped, allowed), reject missing
// token, accept on success, reject on failure, fail-OPEN when
// siteverify is unreachable.
// Usage: node --import ./tests/register.mjs tests/verify-turnstile.ts
import { verifyTurnstile } from "../functions/_lib/turnstile.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};
const mkFetch = (payload: any, throwIt = false) =>
  (async () => {
    if (throwIt) throw new Error("network down");
    return { json: async () => payload } as any;
  }) as unknown as typeof fetch;

// 1. No secret => not configured => skipped + allowed (tool unchanged).
{
  const r = await verifyTurnstile(undefined, "anything", undefined, mkFetch({}));
  ok(r.ok && r.skipped && r.reason === "not-configured", "no secret must be inert (skipped+allowed)");
}

// 2. Secret set, no token => reject (fail closed: likely a bot/script).
{
  const r = await verifyTurnstile("sec", undefined, undefined, mkFetch({}));
  ok(!r.ok && !r.skipped && r.reason === "missing-token", "missing token must be rejected");
}

// 3. Secret + token, siteverify success => allowed.
{
  const r = await verifyTurnstile("sec", "tok", "1.2.3.4", mkFetch({ success: true }));
  ok(r.ok && !r.skipped, "valid token must be allowed");
}

// 4. Secret + token, siteverify failure => reject, surface error codes.
{
  const r = await verifyTurnstile(
    "sec",
    "tok",
    undefined,
    mkFetch({ success: false, "error-codes": ["timeout-or-duplicate"] }),
  );
  ok(!r.ok && !r.skipped && r.reason === "timeout-or-duplicate", "invalid token must be rejected with reason");
}

// 5. siteverify unreachable => FAIL OPEN (do not 403 everyone on a
//    verify-API outage; consistent with the A3 philosophy).
{
  const r = await verifyTurnstile("sec", "tok", undefined, mkFetch(null, true));
  ok(r.ok && r.skipped && r.reason === "verify-unreachable", "verify outage must fail open");
}

if (probs.length === 0) {
  console.log(
    `PASS turnstile (inert w/o secret, reject missing/invalid token, allow valid, fail-open on outage)`,
  );
  process.exit(0);
} else {
  console.log("FAIL turnstile");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
