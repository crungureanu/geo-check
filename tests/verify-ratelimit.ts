// A3 global daily cap: pure-logic test with a mock KV (the live 429
// path cannot be forced without dashboard env access or 500 real
// scans). Asserts: fail-open on no KV, fail-open on a throwing KV,
// counts up, caps exactly at the limit, env override resolution,
// UTC day-key rollover, malformed stored value treated as 0.
// Usage: node --import ./tests/register.mjs tests/verify-ratelimit.ts
import {
  consumeDailyCap,
  resolveDailyCap,
  DEFAULT_DAILY_CAP,
} from "../functions/_lib/ratelimit.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};

// Minimal in-memory KV stand-in (only get/put are used).
function mockKV() {
  const m = new Map<string, string>();
  return {
    store: m,
    async get(k: string) {
      return m.has(k) ? (m.get(k) as string) : null;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
  } as any;
}

// 1. No KV => fail open, never blocks.
{
  const r = await consumeDailyCap(undefined, 10);
  ok(r.allowed === true, "no-KV must fail open (allowed)");
  ok(r.count === 0, "no-KV count should be 0");
}

// 2. Throwing KV => fail open.
{
  const bad = {
    async get() {
      throw new Error("kv down");
    },
    async put() {
      throw new Error("kv down");
    },
  } as any;
  const r = await consumeDailyCap(bad, 10);
  ok(r.allowed === true, "throwing KV must fail open");
}

// 3. Counts up and caps EXACTLY at the limit.
{
  const kv = mockKV();
  const cap = 3;
  const now = new Date("2026-05-18T12:00:00Z");
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(await consumeDailyCap(kv, cap, now));
  ok(seq[0].allowed && seq[0].count === 1, "1st allowed, count 1");
  ok(seq[1].allowed && seq[1].count === 2, "2nd allowed, count 2");
  ok(seq[2].allowed && seq[2].count === 3, "3rd allowed, count 3 (== cap)");
  ok(!seq[3].allowed, "4th must be blocked (count == cap)");
  ok(!seq[4].allowed, "5th must stay blocked");
  ok(
    seq[3].count === 3 && seq[4].count === 3,
    "blocked calls must not increment past cap",
  );
}

// 4. UTC day rollover resets the counter (different key).
{
  const kv = mockKV();
  const cap = 1;
  const d1 = new Date("2026-05-18T23:59:59Z");
  const d2 = new Date("2026-05-19T00:00:01Z");
  const a = await consumeDailyCap(kv, cap, d1);
  const b = await consumeDailyCap(kv, cap, d1);
  const c = await consumeDailyCap(kv, cap, d2);
  ok(a.allowed && !b.allowed, "day1: 1 allowed then capped");
  ok(c.allowed && c.count === 1, "day2: counter reset (new UTC day key)");
}

// 5. Malformed stored value is treated as 0 (defensive, fail open-ish).
{
  const kv = mockKV();
  await kv.put("scancap:2026-05-18", "garbage");
  const r = await consumeDailyCap(kv, 5, new Date("2026-05-18T08:00:00Z"));
  ok(r.allowed && r.count === 1, "garbage counter treated as 0 then incremented");
}

// 6. resolveDailyCap: override parsing + safe fallback.
{
  ok(resolveDailyCap(undefined) === DEFAULT_DAILY_CAP, "undefined => default");
  ok(resolveDailyCap("") === DEFAULT_DAILY_CAP, "empty => default");
  ok(resolveDailyCap("0") === DEFAULT_DAILY_CAP, "0 => default (non-positive)");
  ok(resolveDailyCap("-5") === DEFAULT_DAILY_CAP, "negative => default");
  ok(resolveDailyCap("abc") === DEFAULT_DAILY_CAP, "non-numeric => default");
  ok(resolveDailyCap("250") === 250, "valid override honoured");
  ok(resolveDailyCap("250.9") === 250, "fractional override floored");
}

if (probs.length === 0) {
  console.log(
    `PASS ratelimit (fail-open no-KV/throw, exact cap, UTC rollover, override resolution)`,
  );
  process.exit(0);
} else {
  console.log("FAIL ratelimit");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
