// KV->D1 history backfill: pure-logic test with a mock KV (cursor-paginated)
// and a minimal mock D1 that honours INSERT ... ON CONFLICT(share_id) DO
// NOTHING. Asserts: scanlog rows map to scans rows, old speed scores are
// stored x100, copied/visits come from the share-engagement record, id-less
// old scans get a deterministic legacy:<scanlog-key> id, the cursor is
// cleared when complete, and a full re-run imports nothing (idempotent).
// Usage: node --import ./tests/register.mjs tests/verify-backfill.ts
import { runBackfillBatch, onRequestGet } from "../functions/admin/scans.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};

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
    async delete(k: string) {
      m.delete(k);
    },
    async list(o: { prefix: string; limit?: number; cursor?: string }) {
      const all = [...m.keys()].filter((k) => k.startsWith(o.prefix)).sort();
      const start = o.cursor ? parseInt(o.cursor, 10) : 0;
      const limit = o.limit ?? 1000;
      const page = all.slice(start, start + limit);
      const next = start + limit;
      const list_complete = next >= all.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete,
        cursor: list_complete ? undefined : String(next),
      };
    },
  } as any;
}

// Minimal D1 honouring the one statement the backfill issues.
function mockD1() {
  const rows = new Map<string, Record<string, unknown>>();
  const COLS = [
    "share_id", "at", "domain", "url", "email", "pages", "ai", "classic",
    "content", "mobile", "desktop", "copied", "visits", "kind",
  ];
  const apply = (stmt: any) => {
    if (/INSERT INTO scans/i.test(stmt._sql)) {
      const shareId = stmt._args[0] as string;
      if (rows.has(shareId)) return { meta: { changes: 0 }, success: true, results: [] };
      const row: Record<string, unknown> = {};
      COLS.forEach((c, i) => (row[c] = stmt._args[i]));
      rows.set(shareId, row);
      return { meta: { changes: 1 }, success: true, results: [] };
    }
    return { meta: { changes: 0 }, success: true, results: [] };
  };
  return {
    rows,
    prepare(sql: string) {
      const stmt: any = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          this._args = args;
          return this;
        },
        async run() {
          return apply(this);
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      return stmts.map(apply);
    },
  } as any;
}

function seed(kv: any) {
  // A real (id-bearing) scan, with speed + engagement records.
  kv.store.set(
    "scanlog:0009:aaa",
    JSON.stringify({
      url: "https://example.com/",
      at: "2026-06-10T12:00:00.000Z",
      pages: 10,
      ai: 75,
      classic: 90,
      content: 80,
      id: "abc123",
    }),
  );
  kv.store.set("speedlog:abc123", JSON.stringify({ mobile: 0.54, desktop: 0.67 }));
  kv.store.set("sharestat:abc123", JSON.stringify({ copied: true, visits: 3 }));
  // An id-less (stateless) scan: no speed/engagement, content null.
  kv.store.set(
    "scanlog:0008:bbb",
    JSON.stringify({
      url: "https://no-id.example/",
      at: "2026-06-11T09:30:00.000Z",
      pages: 5,
      ai: 60,
      classic: 70,
    }),
  );
}

// 1. D1 off -> ok:false, nothing imported.
{
  const kv = mockKV();
  seed(kv);
  const r = await runBackfillBatch({ SHARES: kv });
  ok(r.ok === false && r.imported === 0, "D1 off must be a no-op (ok:false)");
}

// 2. Fresh import: both rows land, fields mapped, speed x100.
const kv = mockKV();
const db = mockD1();
seed(kv);
const env = { SHARES: kv, DB: db, D1_ENABLED: "1" };
{
  const r = await runBackfillBatch(env);
  ok(r.ok === true, "enabled run must be ok");
  ok(r.imported === 2, `first run imports both rows (got ${r.imported})`);
  ok(r.scanned === 2, `scanned both scanlog keys (got ${r.scanned})`);
  ok(r.done === true, "single page => done");
  ok((await kv.get("backfill:cursor")) === null, "cursor cleared when done");

  const real = db.rows.get("abc123");
  ok(!!real, "id-bearing scan keyed by its share id");
  ok(real?.mobile === 54 && real?.desktop === 67, "speed stored x100");
  ok(real?.copied === 1 && real?.visits === 3, "copied/visits from share stat");
  ok(real?.ai === 75 && real?.classic === 90 && real?.content === 80, "scores mapped");
  ok(real?.domain === "example.com", "domain normalised");

  const legacy = db.rows.get("legacy:scanlog:0008:bbb");
  ok(!!legacy, "id-less scan gets deterministic legacy:<key> id");
  ok(legacy?.mobile == null && legacy?.desktop == null, "id-less scan has no speed");
  ok(legacy?.copied === 0 && legacy?.visits === 0, "id-less scan has no engagement");
  ok(legacy?.content == null, "absent content maps to null");
}

// 3. Idempotency: a full re-run imports nothing and never duplicates.
{
  const before = db.rows.size;
  const r = await runBackfillBatch(env);
  ok(r.imported === 0, `re-run imports nothing (got ${r.imported})`);
  ok(db.rows.size === before, "re-run must not change row count");
}

// 4. Admin page actually RENDERS (not just loads): invoke the GET handler with
// a cookie-authed request and a D1-on env. Guards against render-time throws
// like the page()/page-variable shadowing that caused a 1101 (the module
// loading clean is not enough; the handler must run).
{
  const kv2 = mockKV();
  const db2 = mockD1();
  const env2 = { ADMIN_KEY: "secret", D1_ENABLED: "1", DB: db2, SHARES: kv2 };
  const req = new Request("https://x/admin/scans", {
    headers: { Cookie: "xeo_admin=secret" },
  });
  let res: Response | null = null;
  try {
    res = (await onRequestGet({ request: req, env: env2, params: {} } as any)) as Response;
  } catch (e) {
    probs.push("admin GET threw: " + ((e as any)?.stack || String(e)));
  }
  if (res) {
    ok(res.status === 200, `admin GET should render 200 (got ${res.status})`);
    const html = await res.text();
    ok(html.includes("Websites scanned"), "admin renders the scans tab");
    ok(html.includes("Delete selected"), "admin renders the bulk-delete control (D1 mode)");
    ok(html.includes("type=\"checkbox\""), "admin renders row checkboxes");
  }
}

if (probs.length) {
  console.error("FAIL backfill\n - " + probs.join("\n - "));
  process.exit(1);
}
console.log("PASS backfill (mapping, speed x100, legacy id, cursor clear, idempotent re-run, admin renders)");
