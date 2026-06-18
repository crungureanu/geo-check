// Admin scans tab: URL search ("contains"), clickable links, the bottom
// delete button, and the Visual-reports daily charts, exercised through the
// real onRequestGet handler with a stateful mock D1 that applies the LIKE
// filter and serves the daily-window query. Locks the search-threaded
// pagination and the chart render so neither can silently regress.
// Usage: node --import ./tests/register.mjs tests/verify-admin-search-charts.ts
import { onRequestGet } from "../functions/admin/scans.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};

function mockKV() {
  const m = new Map<string, string>();
  return {
    async get() { return null; },
    async put() {},
    async delete() {},
    async list(o: { prefix: string }) {
      const keys = [...m.keys()].filter((k) => k.startsWith(o.prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  } as any;
}

// Mock D1 that honours the WHERE url LIKE filter and the daily-window query.
function statefulD1(rows: any[]) {
  const core = (pattern: string) => String(pattern).replace(/[%\\]/g, "");
  const api: any = {
    rows,
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() {
          if (/COUNT\(\*\)/i.test(sql)) {
            let data = api.rows as any[];
            if (/LIKE/i.test(sql)) {
              const t = core(args[0]);
              data = data.filter((r) => r.url.includes(t));
            }
            const pages = data.reduce((s: number, r: any) => s + (r.pages || 0), 0);
            return { scans: data.length, pages };
          }
          return null;
        },
        async all() {
          // Paged list: has OFFSET. May be filtered (LIKE) -> [pattern,limit,offset].
          if (/OFFSET/i.test(sql)) {
            let data = [...api.rows];
            let limit: number, offset: number;
            if (/LIKE/i.test(sql)) {
              const t = core(args[0]);
              data = data.filter((r) => r.url.includes(t));
              limit = args[1]; offset = args[2];
            } else {
              limit = args[0]; offset = args[1];
            }
            data.sort((a, b) => b.at - a.at);
            return {
              results: data.slice(offset, offset + limit).map((r) => ({ ...r, content_unlocked: 0 })),
              success: true, meta: {},
            };
          }
          // Daily-window query: SELECT at, url FROM scans WHERE at >= ? ...
          if (/at >=/i.test(sql)) {
            const since = args[0];
            return {
              results: api.rows.filter((r: any) => r.at >= since).map((r: any) => ({ at: r.at, url: r.url })),
              success: true, meta: {},
            };
          }
          return { results: [], success: true, meta: {} };
        },
        async run() { return { success: true, meta: { changes: 0 }, results: [] }; },
      };
      return stmt;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map((s: any) => s.run())); },
  };
  return api;
}

const now = Date.now();
const cookieReq = (url: string) =>
  new Request(url, { headers: { Cookie: "xeo_admin=secret" } });

// Build a mixed set: 150 dexion.com rows (incl. sub-pages) + 60 other rows.
// All timestamped within the last few days so the charts have data, with one
// duplicate URL on "today" so total > unique that day.
const rows: any[] = [];
for (let i = 0; i < 150; i++) {
  rows.push({
    share_id: `d${i}`, at: now - (i % 20) * 3600_000,
    domain: "dexion.com", url: i % 5 === 0 ? "https://dexion.com/about" : `https://dexion.com/p${i}`,
    email: null, pages: 3, ai: 60, classic: 70, content: null, mobile: null, desktop: null,
    copied: 0, visits: 0, kind: "free",
  });
}
for (let i = 0; i < 60; i++) {
  rows.push({
    share_id: `o${i}`, at: now - (i % 10) * 3600_000,
    domain: `other${i}.com`, url: `https://other${i}.com/`,
    email: null, pages: 1, ai: 50, classic: 55, content: null, mobile: null, desktop: null,
    copied: 0, visits: 0, kind: "free",
  });
}
const db = statefulD1(rows);
const env: any = { ADMIN_KEY: "secret", D1_ENABLED: "1", DB: db, SHARES: mockKV() };

// 1. No search: full total 210, clickable link, two delete bars, charts tab.
{
  const res = (await onRequestGet({ request: cookieReq("https://x/admin/scans"), env, params: {} } as any)) as Response;
  ok(res.status === 200, `renders 200 (got ${res.status})`);
  const html = await res.text();
  ok(html.includes("210 scan(s) total"), "unfiltered sub-line shows full total 210");
  ok(/<a href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer nofollow">/.test(html), "URL cell is a new-tab link");
  ok((html.match(/Delete selected/g) || []).length >= 2, "two Delete-selected bars (top + bottom)");
  ok(html.includes('id="tab-charts"'), "Visual reports tab present");
  ok(html.includes('id="panel-charts"'), "Visual reports panel present");
  ok((html.match(/<svg /g) || []).length === 2, "two line charts rendered");
  ok(html.includes("Scans per day") && html.includes("Unique URLs scanned per day"), "both chart titles present");
  ok((html.match(/<polyline /g) || []).length === 2, "each chart has a line");
  // Segmented total-vs-domains bar: 150 dexion.com (1 domain) + 60 distinct
  // domains = 61 unique, 149 repeat, 210 total.
  ok(html.includes("Total scans vs unique domains"), "segmented bar present");
  ok(html.includes("adm-segbar"), "segmented bar element rendered");
  ok(html.includes("Unique domains: <b>61</b>"), "unique-domain count correct (61)");
  ok(html.includes("Repeat scans: <b>149</b>"), "repeat-scan count correct (149)");
  ok(html.includes("Total scans: <b>210</b>"), "total-scan count correct (210)");
  // Only dexion.com is scanned more than once (150x); the 60 others are 1 each.
  ok(html.includes("Of 61 domain(s), <b>1</b> was scanned more than once"), "rescanned-domains count correct (1 of 61)");
}

// 2. Search ?q=dexion: 150 results, pagination over the FILTERED set (2 pages),
//    and the pager link carries the query so paging stays filtered.
{
  const res = (await onRequestGet({ request: cookieReq("https://x/admin/scans?q=dexion"), env, params: {} } as any)) as Response;
  const html = await res.text();
  ok(html.includes('150 result(s) for "dexion"'), "filtered sub-line shows 150 results for dexion");
  ok(html.includes("Page 1 / 2"), "filtered pagination is 2 pages (150/100)");
  ok(html.includes("q=dexion"), "pager/links carry the search term");
  ok(html.includes('value="dexion"'), "search box keeps the typed term");
  ok(!html.includes("other0.com"), "non-matching rows are excluded");
}

// 3. Search with no matches: 0 results, clean empty state, Clear link offered.
{
  const res = (await onRequestGet({ request: cookieReq("https://x/admin/scans?q=zzzznope"), env, params: {} } as any)) as Response;
  const html = await res.text();
  ok(html.includes('0 result(s) for "zzzznope"'), "no-match search shows 0 results");
  ok(html.includes("No scans logged yet"), "no-match shows the empty-state row");
  ok(html.includes("adm-clear"), "Clear-search link is offered when filtering");
}

if (probs.length) {
  console.error("FAIL admin-search-charts\n - " + probs.join("\n - "));
  process.exit(1);
}
console.log("PASS admin-search-charts (URL search + clickable links + dual delete bars + daily charts)");
