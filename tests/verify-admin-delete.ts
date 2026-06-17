// d1DeleteScans (admin bulk delete): the risky part is that the IN-list
// placeholder count must exactly match the number of bound params, and the
// caller cap (100) must hold. A mismatch would throw at runtime in production.
// This drives the helper against a mock D1 that captures the prepared SQL and
// bound args, with no SQL emulation needed.
// Usage: node --import ./tests/register.mjs tests/verify-admin-delete.ts
import { d1DeleteScans } from "../functions/_lib/d1.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};

// Mock D1 that records every prepare(sql).bind(...args).run().
function captureD1() {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      const stmt: any = {
        sql,
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return stmt;
        },
        async run() {
          return { success: true, meta: { changes: 0 }, results: [] };
        },
      };
      return stmt;
    },
  } as any;
}

const enabled = (db: any) => ({ DB: db, D1_ENABLED: "1" });

// 1. D1 off -> no-op (no prepare/bind).
{
  const db = captureD1();
  await d1DeleteScans({ DB: db } as any, ["a", "b"]); // D1_ENABLED missing
  ok(db.calls.length === 0, "D1 disabled must issue no statement");
}

// 2. Empty id list -> no-op.
{
  const db = captureD1();
  await d1DeleteScans(enabled(db) as any, []);
  ok(db.calls.length === 0, "empty id list must issue no statement");
}

// 3. Normal case: placeholders match args, in order.
{
  const db = captureD1();
  const ids = ["id1", "anon:2:xy", "legacy:scanlog:0009:aa"];
  await d1DeleteScans(enabled(db) as any, ids);
  ok(db.calls.length === 1, "one DELETE statement issued");
  const { sql, args } = db.calls[0];
  const placeholders = (sql.match(/\?/g) || []).length;
  ok(/DELETE FROM scans WHERE share_id IN \(/.test(sql), "uses an IN-list delete");
  ok(placeholders === ids.length, `placeholder count (${placeholders}) must equal id count (${ids.length})`);
  ok(args.length === ids.length, `bound arg count (${args.length}) must equal id count (${ids.length})`);
  ok(args.join("|") === ids.join("|"), "bound args are the ids, in order");
}

// 4. Over-cap: more than 100 ids must be capped to 100, placeholders == args.
{
  const db = captureD1();
  const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
  await d1DeleteScans(enabled(db) as any, ids);
  ok(db.calls.length === 1, "one statement even when capping");
  const { sql, args } = db.calls[0];
  const placeholders = (sql.match(/\?/g) || []).length;
  ok(placeholders === 100, `capped to 100 placeholders (got ${placeholders})`);
  ok(args.length === 100, `capped to 100 bound args (got ${args.length})`);
  ok(placeholders === args.length, "placeholders and bound args stay in lockstep at the cap");
  ok(args[0] === "id0" && args[99] === "id99", "keeps the first 100 ids");
}

if (probs.length) {
  console.error("FAIL admin-delete\n - " + probs.join("\n - "));
  process.exit(1);
}
console.log("PASS admin-delete (d1DeleteScans: off/empty no-op, IN placeholders == bound args, 100 cap)");
