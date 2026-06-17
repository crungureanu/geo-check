// Admin scans tab: pagination + bulk-delete POST, end to end through the real
// onRequestGet/onRequestPost handlers, with a stateful mock D1 (COUNT, SELECT
// LIMIT/OFFSET, DELETE ... IN) and mock KV. Locks the audit M1 fix (an
// out-of-range ?p= must clamp to the last real page, not render empty) and the
// delete-scans-bulk path that has no other runtime coverage.
// Usage: node --import ./tests/register.mjs tests/verify-admin-paging.ts
import { onRequestGet, onRequestPost } from "../functions/admin/scans.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};

function mockKV() {
  const m = new Map<string, string>();
  return {
    store: m,
    async get(k: string) { return m.has(k) ? (m.get(k) as string) : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    async list(o: { prefix: string; limit?: number; cursor?: string }) {
      const keys = [...m.keys()].filter((k) => k.startsWith(o.prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  } as any;
}

// Stateful mock D1 implementing only the three queries the admin issues.
function statefulD1(rows: any[]) {
  const api: any = {
    rows,
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() {
          if (/COUNT\(\*\)/i.test(sql)) {
            const pages = api.rows.reduce((s: number, r: any) => s + (r.pages || 0), 0);
            return { scans: api.rows.length, pages };
          }
          return null;
        },
        async all() {
          if (/FROM scans/i.test(sql) && /LIMIT/i.test(sql)) {
            const [limit, offset] = args as number[];
            const sorted = [...api.rows].sort((a, b) => b.at - a.at);
            const page = sorted.slice(offset, offset + limit).map((r) => ({ ...r, content_unlocked: 0 }));
            return { results: page, success: true, meta: {} };
          }
          return { results: [], success: true, meta: {} };
        },
        async run() {
          if (/DELETE FROM scans WHERE share_id IN/i.test(sql)) {
            const set = new Set(args);
            for (let i = api.rows.length - 1; i >= 0; i--) {
              if (set.has(api.rows[i].share_id)) api.rows.splice(i, 1);
            }
          }
          return { success: true, meta: { changes: 0 }, results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map((s: any) => s.run())); },
  };
  return api;
}

function makeRows(n: number) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      share_id: `s${i}`,
      at: 1_700_000_000_000 + i * 1000, // ascending, so newest = highest index
      domain: `site${i}.com`,
      url: `https://site${i}.com/`,
      email: null,
      pages: 2,
      ai: 70, classic: 80, content: null, mobile: null, desktop: null,
      copied: 0, visits: 0, kind: "free",
    });
  }
  return rows;
}

const cookieReq = (url: string) =>
  new Request(url, { headers: { Cookie: "xeo_admin=secret" } });

// 250 rows -> 3 pages of 100/100/50.
const rows = makeRows(250);
const db = statefulD1(rows);
const kv = mockKV();
const env: any = { ADMIN_KEY: "secret", D1_ENABLED: "1", DB: db, SHARES: kv };

// 1. Page 0: first 100 (newest = s249..s150), pager "Page 1 / 3", badge 250.
{
  const res = (await onRequestGet({ request: cookieReq("https://x/admin/scans"), env, params: {} } as any)) as Response;
  ok(res.status === 200, `page 0 renders 200 (got ${res.status})`);
  const html = await res.text();
  ok(html.includes("Page 1 / 3"), "pager shows Page 1 / 3");
  ok(html.includes(">250<"), "tab badge shows the full total 250");
  ok(html.includes('value="s249"'), "newest row (s249) on page 0");
  ok(!html.includes('value="s149"'), "row 149 is on page 1, not page 0");
}

// 2. Last page ?p=2: rows s49..s0 (50 rows), pager "Page 3 / 3".
{
  const res = (await onRequestGet({ request: cookieReq("https://x/admin/scans?p=2"), env, params: {} } as any)) as Response;
  const html = await res.text();
  ok(html.includes("Page 3 / 3"), "p=2 shows Page 3 / 3");
  ok(html.includes('value="s0"'), "oldest row (s0) on the last page");
}

// 3. M1: out-of-range ?p=999 must CLAMP to the last real page, not render empty.
{
  const res = (await onRequestGet({ request: cookieReq("https://x/admin/scans?p=999"), env, params: {} } as any)) as Response;
  const html = await res.text();
  ok(html.includes("Page 3 / 3"), "out-of-range page clamps to the last page");
  ok(html.includes('value="s0"'), "clamped page shows real rows (not empty)");
  ok(!html.includes("No scans logged yet"), "clamped page is not the empty-state");
}

// 4. Bulk delete POST: remove 3 rows, expect 303 back to the posted page and
//    the rows gone from D1.
{
  const body = new URLSearchParams();
  body.set("action", "delete-scans-bulk");
  body.set("p", "1");
  body.append("sel", "s249");
  body.append("sel", "s248");
  body.append("sel", "s247");
  const req = new Request("https://x/admin/scans", {
    method: "POST",
    headers: { Cookie: "xeo_admin=secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const res = (await onRequestPost({ request: req, env, params: {} } as any)) as Response;
  ok(res.status === 303, `bulk delete redirects 303 (got ${res.status})`);
  ok((res.headers.get("Location") || "").includes("p=1"), "redirect returns to the posted page");
  ok(db.rows.length === 247, `3 rows deleted from D1 (now ${db.rows.length})`);
  ok(!db.rows.some((r: any) => r.share_id === "s249"), "s249 actually removed");
}

if (probs.length) {
  console.error("FAIL admin-paging\n - " + probs.join("\n - "));
  process.exit(1);
}
console.log("PASS admin-paging (pages 1/3..3/3, out-of-range clamp [M1], bulk-delete POST removes rows + 303)");
