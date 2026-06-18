import {
  listScanLog,
  listContactMessages,
  listUnlockRequests,
  deleteContactMessage,
  deleteScanRecord,
  deleteScanShareData,
  deleteUnlockLead,
  getSpeedScores,
  getShareStat,
} from "../_lib/kv";
import type { ScanLogEntry, ContactMessage, UnlockLead } from "../_lib/kv";
import {
  d1,
  d1ListScans,
  d1DeleteScans,
  d1Totals,
  d1BackfillScans,
  d1ScansSince,
} from "../_lib/d1";
import type { AdminScanRow, BackfillScanRow } from "../_lib/d1";

// One backfill batch: import up to 100 KV scanlog rows into D1, resuming from
// a stored cursor so the operator can click through the whole history. Real
// scans keep their share id (ON CONFLICT skips a live row); id-less old scans
// get a deterministic legacy:<scanlog-key> id so a full re-run never dupes.
// Speed + engagement are pulled from their own KV records (old speed scores
// are 0-1, stored x100 to match the live column). Returns progress.
const BACKFILL_CURSOR = "backfill:cursor";
export async function runBackfillBatch(
  env: { SHARES?: KVNamespace; DB?: D1Database; D1_ENABLED?: string },
): Promise<{ imported: number; scanned: number; done: boolean; ok: boolean }> {
  const kv = env.SHARES;
  if (!kv || !d1(env)) return { imported: 0, scanned: 0, done: true, ok: false };
  const saved = (await kv.get(BACKFILL_CURSOR)) || undefined;
  const res: any = await kv.list({ prefix: "scanlog:", limit: 100, cursor: saved });
  const rows: BackfillScanRow[] = [];
  for (const k of res.keys as { name: string }[]) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    let e: ScanLogEntry;
    try {
      e = JSON.parse(raw) as ScanLogEntry;
    } catch {
      continue;
    }
    const id = typeof e.id === "string" && e.id ? e.id : null;
    const at = Date.parse(e.at) || Date.now();
    const share_id = id || `legacy:${k.name}`;
    let mobile: number | null = null;
    let desktop: number | null = null;
    let copied = 0;
    let visits = 0;
    if (id) {
      const sp = await getSpeedScores(kv, id);
      if (sp) {
        mobile = sp.mobile != null ? Math.round(sp.mobile * 100) : null;
        desktop = sp.desktop != null ? Math.round(sp.desktop * 100) : null;
      }
      const st = await getShareStat(kv, id);
      if (st) {
        copied = st.copied ? 1 : 0;
        visits = st.visits || 0;
      }
    }
    rows.push({
      share_id,
      at,
      url: e.url,
      pages: e.pages ?? null,
      ai: e.ai ?? null,
      classic: e.classic ?? null,
      content: e.content ?? null,
      mobile,
      desktop,
      copied,
      visits,
    });
  }
  const imported = await d1BackfillScans(env, rows);
  const done = Boolean(res.list_complete) || !res.cursor;
  if (done) await kv.delete(BACKFILL_CURSOR);
  else await kv.put(BACKFILL_CURSOR, res.cursor);
  return { imported, scanned: res.keys.length, done, ok: true };
}

interface Env {
  SHARES?: KVNamespace;
  // Required secret. Set in Cloudflare Pages env vars. The page is
  // unreachable (401) until this is configured.
  ADMIN_KEY?: string;
  // D1 binding + flag. When both are present the scans tab reads from D1
  // (restoring the Mobile/Desktop/Copied/Visits columns in one cheap
  // query); otherwise it falls back to the KV stopgap below.
  DB?: D1Database;
  D1_ENABLED?: string;
}

const esc = (s: unknown): string =>
  String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!),
  );

// The Worker runs in UTC, so a bare toLocaleString shows UTC (an hour
// behind the UK in BST). Pin the operator's timezone so the admin
// timestamps read correctly.
const fmtWhen = (at: number | string): string =>
  new Date(at).toLocaleString("en-GB", { timeZone: "Europe/London" });

// Constant-time-ish compare so the secret cannot be guessed by timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Auth: the key may arrive once as ?key= (bookmark / first visit) but
// must not LIVE in the URL, where it leaks via browser history and CDN
// logs. A valid ?key= is swapped into an HttpOnly cookie with a
// redirect to the clean URL; every later request authenticates from
// the cookie. Wrong/absent key keeps the existing 404 (endpoint stays
// invisible to probing).
const ADMIN_COOKIE = "xeo_admin";

function cookieValue(request: Request, name: string): string {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        return "";
      }
    }
  }
  return "";
}

type AdminAuth = { ok: false } | { ok: true; setCookie: boolean };

function checkAdminAuth(request: Request, adminKey: string | undefined): AdminAuth {
  if (!adminKey) return { ok: false };
  const cookie = cookieValue(request, ADMIN_COOKIE);
  if (cookie && safeEqual(cookie, adminKey)) return { ok: true, setCookie: false };
  const key = new URL(request.url).searchParams.get("key") || "";
  if (key && safeEqual(key, adminKey)) return { ok: true, setCookie: true };
  return { ok: false };
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });
}

// 302 to the same path without ?key=, carrying the auth cookie.
// Scoped to /admin, 30-day lifetime (re-visit with ?key= renews it).
function redirectWithCookie(request: Request, adminKey: string): Response {
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.pathname,
      "Set-Cookie":
        `${ADMIN_COOKIE}=${encodeURIComponent(adminKey)}; Path=/admin; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "no-store",
    },
  });
}

// Small inline CSS for the admin-only tab bar so we do not bloat the
// public styles.css. Reuses the existing .adm container styles.
const TABS_CSS = `
.adm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:8px 0 24px;padding-bottom:0}
.adm-tab{appearance:none;background:transparent;border:0;padding:10px 16px;font:inherit;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.adm-tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.adm-tab:hover{color:var(--ink)}
.adm-panel[hidden]{display:none}
.adm-count{background:var(--line);color:var(--muted);font-size:11px;font-weight:500;padding:2px 7px;border-radius:999px;margin-left:6px;vertical-align:1px}
.adm-tab[aria-selected="true"] .adm-count{background:var(--accent-soft);color:var(--accent)}
.adm-delform{display:inline;margin:0}
.adm-del{appearance:none;background:transparent;border:1px solid var(--line);border-radius:6px;color:var(--muted);font:inherit;font-size:12px;padding:2px 8px;cursor:pointer}
.adm-del:hover{color:#b91c1c;border-color:#b91c1c}
.adm-bulkbar{display:flex;justify-content:flex-end;margin:0 0 8px}
.adm-sel,#sel-all{width:16px;height:16px;cursor:pointer}
.adm-pager{display:flex;align-items:center;gap:14px;justify-content:center;margin:16px 0}
.adm-page{font-size:13px;color:var(--accent);text-decoration:none;padding:4px 8px;border:1px solid var(--line);border-radius:6px}
.adm-page:hover{border-color:var(--accent)}
.adm-page.is-off{color:var(--muted);opacity:.5;pointer-events:none}
.adm-pageinfo{font-size:12px;color:var(--muted)}
.adm-search{display:flex;gap:8px;align-items:center;margin:0 0 12px;flex-wrap:wrap}
.adm-search input[type=search]{flex:1;min-width:220px;font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)}
.adm-search button{appearance:none;background:var(--accent);border:0;border-radius:6px;color:#fff;font:inherit;font-size:13px;font-weight:500;padding:7px 14px;cursor:pointer}
.adm-search .adm-clear{font-size:13px;color:var(--muted);text-decoration:none;padding:7px 4px}
.adm-search .adm-clear:hover{color:var(--ink)}
td.u a{color:var(--accent);text-decoration:none}
td.u a:hover{text-decoration:underline}
.adm-charts{display:flex;flex-direction:column;gap:28px;margin-top:8px}
.adm-chart{margin:0}
.adm-chart figcaption{font-size:14px;font-weight:600;color:var(--ink);margin:0 0 8px}
.adm-chart svg{width:100%;height:auto;display:block;overflow:visible}
.adm-chart .axis{stroke:var(--line)}
.adm-chart .grid{stroke:var(--line);stroke-dasharray:2 3;opacity:.6}
.adm-chart .lbl{fill:var(--muted);font-size:11px}
.adm-chart .ln{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.adm-chart .dot{fill:var(--accent)}
`;

const TABS_JS = `
(function(){
  var tabs=document.querySelectorAll('[role="tab"]');
  var panels={};
  tabs.forEach(function(t){panels[t.getAttribute('aria-controls')]=document.getElementById(t.getAttribute('aria-controls'));});
  function select(id){
    tabs.forEach(function(t){
      var on=t.getAttribute('aria-controls')===id;
      t.setAttribute('aria-selected',on?'true':'false');
      t.setAttribute('tabindex',on?'0':'-1');
    });
    Object.keys(panels).forEach(function(k){panels[k].hidden=k!==id;});
    try{history.replaceState(null,'',location.pathname+location.search+'#'+id);}catch(e){}
  }
  tabs.forEach(function(t){
    t.addEventListener('click',function(){select(t.getAttribute('aria-controls'));});
    t.addEventListener('keydown',function(e){
      if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
      e.preventDefault();
      var i=Array.prototype.indexOf.call(tabs,t);
      var n=(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      tabs[n].focus(); select(tabs[n].getAttribute('aria-controls'));
    });
  });
  // Honour #panel-id in the URL on load so links can deep-link to a tab.
  var h=(location.hash||'').replace('#','');
  if(h && panels[h]) select(h);
})();
`;

function page(body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
      `<meta name="robots" content="noindex,nofollow"/>` +
      `<title>XEOscan admin</title>` +
      `<link rel="stylesheet" href="/styles.css?v=20260519o"/>` +
      `<style>${TABS_CSS}</style></head><body>` +
      `<main><div class="adm">${body}</div></main>` +
      `<script>${TABS_JS}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = checkAdminAuth(request, env.ADMIN_KEY);
  if (!auth.ok) return notFound();
  // Key arrived in the URL: move it into the cookie and strip it from
  // the address bar before rendering anything.
  if (auth.setCookie) return redirectWithCookie(request, env.ADMIN_KEY!);

  // Stopgap (data-layer-redesign-plan.md §11): cap each list to 100 and
  // fail-soft. The previous design read 500/200/200 rows AND fired a
  // per-row speed + share KV join per scan (~2,300 KV reads/load). With
  // the three list calls unguarded, any single KV throw bubbled up as an
  // uncaught exception (Error 1101); the volume could also time out.
  // Capping + try/catch + dropping the per-row joins removes both. The
  // D1-backed admin view restores the speed/share columns and the cap.
  // Scans tab is paginated: 100 rows per page, ?p=<0-based> selects the page.
  const PAGE_SIZE = 100;
  const reqUrl = new URL(request.url);
  const reqParams = reqUrl.searchParams;
  const reqPage = Math.max(0, parseInt(reqParams.get("p") || "0", 10) || 0);
  // Scans-tab "contains" search. Trimmed + length-capped; an empty term is no
  // filter. Threaded through pagination, the bulk-delete form and the pager.
  const query = (reqParams.get("q") || "").trim().slice(0, 200);
  // Visual-reports window (days back). Default 30; a future range selector just
  // sets ?days=. Clamped so a silly value can never pull a huge row set.
  const chartDays = Math.min(Math.max(parseInt(reqParams.get("days") || "30", 10) || 30, 1), 365);
  const chartSince = Date.now() - chartDays * 86400000;

  // Get the total (and detect D1) BEFORE fetching a page, so an out-of-range
  // ?p= can be clamped to a real page instead of running a deep OFFSET that
  // returns an empty table (audit M1). d1Totals returns null when D1 is off.
  // The total honours the active search so pagination matches the filtered set.
  let d1Total: { scans: number; pages: number } | null = null;
  let kvMsgs: ContactMessage[] = [];
  let kvLeads: UnlockLead[] = [];
  let chartRows: { at: number; url: string }[] | null = null;
  try {
    [d1Total, kvMsgs, kvLeads, chartRows] = await Promise.all([
      d1Totals(env, query || undefined),
      listContactMessages(env.SHARES, 100),
      listUnlockRequests(env.SHARES, 100),
      d1ScansSince(env, chartSince),
    ]);
  } catch (e) {
    // A KV/D1 blip must never 1101 the whole admin page; render what we have.
    console.error("admin_list_failed", (e as any)?.stack || String(e));
  }

  // Scans read from D1 (where the per-row fan-out behind the 1101 outage was,
  // and where the backfill lives); fall back to the KV stopgap when D1 is off.
  // Messages + Unlock leads read from KV: those lists are small and capped (no
  // fan-out), KV is still their source of truth, and KV holds the FULL history
  // (reading D1 would only show rows written after the dual-write went live).
  const usingD1 = d1Total !== null;
  const d1ScanTotal = d1Total?.scans ?? 0;
  const totalPages = usingD1 ? Math.max(1, Math.ceil(d1ScanTotal / PAGE_SIZE)) : 1;
  const pageNo = Math.min(reqPage, totalPages - 1);

  let d1Scans: AdminScanRow[] = [];
  let kvScans: ScanLogEntry[] = [];
  if (usingD1) {
    try {
      d1Scans =
        (await d1ListScans(env, {
          limit: PAGE_SIZE,
          offset: pageNo * PAGE_SIZE,
          q: query || undefined,
        })) ?? [];
    } catch (e) {
      console.error("admin_d1_scans_failed", (e as any)?.stack || String(e));
    }
  } else {
    try {
      kvScans = await listScanLog(env.SHARES, 100);
    } catch (e) {
      console.error("admin_kv_scans_failed", (e as any)?.stack || String(e));
    }
  }
  // Tab badge: the full D1 total (the table shows one page of it) or the KV count.
  const scanCount = usingD1 ? d1ScanTotal : kvScans.length;
  const msgCount = kvMsgs.length;
  const leadCount = kvLeads.length;

  // Diagnostic: fetch the raw KV key count under msg: so we can tell "no
  // messages were ever saved" (0 keys) apart from "messages exist but failed
  // to parse" (N keys, 0 messages rendered).
  let msgKeyCount = 0;
  try {
    if (env.SHARES) {
      // Match the 100 cap on listContactMessages above, so the diagnostic
      // compares like-for-like (raw keys vs rendered) instead of false-
      // alarming whenever there are more than 100 messages.
      const res: any = await env.SHARES.list({ prefix: "msg:", limit: 100 });
      msgKeyCount = res.keys?.length ?? 0;
    }
  } catch {
    msgKeyCount = -1;
  }

  // GDPR / operator erasure. Plain form POST (no JS dependency); the
  // confirm() guard avoids accidental clicks. KV list is eventually
  // consistent, so a deleted row can linger in the list briefly.
  const delForm = (action: string, key: string | undefined, confirmMsg: string): string =>
    key
      ? `<form method="post" class="adm-delform" onsubmit="return confirm('${confirmMsg}')">` +
        `<input type="hidden" name="action" value="${action}"/>` +
        `<input type="hidden" name="k" value="${esc(key)}"/>` +
        `<button type="submit" class="adm-del">Delete</button></form>`
      : "-";
  const SCAN_CONFIRM =
    "Delete this scan permanently? This also removes its share report, speed scores and engagement record. It can take up to a minute to disappear from the list.";
  const MSG_CONFIRM =
    "Delete this message permanently? It can take up to a minute to disappear from the list.";
  const LEAD_CONFIRM =
    "Delete this lead permanently? This also removes their connection token, so their Content scan unlock stops working. It can take up to a minute to disappear from the list.";

  const numOrDash = (n: number | null | undefined): string =>
    typeof n === "number" ? esc(n) : "-";

  // D1 path: every column is real. Content shows only when the scan's email
  // maps to a redeemed connection (content_unlocked = 1), so a computed-but-
  // never-unlocked content score never looks like a content scan the user ran.
  // The lead column is a checkbox (value = share id) for bulk delete.
  const d1ScanRows = (d1Scans ?? [])
    .map((s) => {
      const content =
        s.content_unlocked === 1 && typeof s.content === "number"
          ? esc(s.content)
          : "-";
      return (
        `<tr><td><input type="checkbox" class="adm-sel" name="sel" value="${esc(s.share_id)}" aria-label="select row"/></td>` +
        `<td>${esc(fmtWhen(s.at))}</td>` +
        `<td class="u"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.url)}</a></td>` +
        `<td>${numOrDash(s.pages)}</td>` +
        `<td>${numOrDash(s.ai)}</td>` +
        `<td>${numOrDash(s.classic)}</td>` +
        `<td>${content}</td>` +
        `<td>${numOrDash(s.mobile)}</td>` +
        `<td>${numOrDash(s.desktop)}</td>` +
        `<td>${s.copied ? "Yes" : "-"}</td>` +
        `<td>${s.visits ? esc(s.visits) : "-"}</td></tr>`
      );
    })
    .join("");

  // KV stopgap path (D1 off): Mobile/Desktop/Copied/Visits show "-" because
  // their per-row joins were dropped to kill the 1101 fan-out.
  const kvScanRows = kvScans
    .map(
      (s) =>
        `<tr><td>${esc(fmtWhen(s.at))}</td>` +
        `<td class="u"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.url)}</a></td>` +
        `<td>${esc(s.pages ?? "")}</td>` +
        `<td>${esc(s.ai ?? "")}</td>` +
        `<td>${esc(s.classic ?? "")}</td>` +
        `<td>${esc(s.content ?? "-")}</td>` +
        `<td>-</td><td>-</td><td>-</td><td>-</td>` +
        `<td>${delForm("delete-scan", s.key, SCAN_CONFIRM)}</td></tr>`,
    )
    .join("");

  const scanRows = scanCount
    ? usingD1
      ? d1ScanRows
      : kvScanRows
    : `<tr><td colspan="11">No scans logged yet.</td></tr>`;

  const msgRowHtml = (
    m: { at: number | string; name: unknown; email: unknown; message: unknown },
    action: string,
    key: string | undefined,
  ): string =>
    `<tr><td>${esc(fmtWhen(m.at))}</td>` +
    `<td>${esc(m.name)}</td>` +
    `<td class="u"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td>` +
    `<td>${esc(m.message)}</td>` +
    `<td>${delForm(action, key, MSG_CONFIRM)}</td></tr>`;

  const msgRows = msgCount
    ? kvMsgs.map((m) => msgRowHtml(m, "delete-msg", m.key)).join("")
    : `<tr><td colspan="5">No messages.</td></tr>`;

  const leadRowHtml = (
    l: { at: number | string; email: unknown; url: unknown; redeemed: unknown },
    action: string,
    key: string | undefined,
  ): string =>
    `<tr><td>${esc(fmtWhen(l.at))}</td>` +
    `<td class="u"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>` +
    `<td class="u">${esc(l.url)}</td>` +
    `<td>${l.redeemed ? "Yes" : "No"}</td>` +
    `<td>${delForm(action, key, LEAD_CONFIRM)}</td></tr>`;

  const leadRows = leadCount
    ? kvLeads.map((l) => leadRowHtml(l, "delete-lead", l.key)).join("")
    : `<tr><td colspan="5">No unlock requests yet.</td></tr>`;

  // The diagnostic line shows when the raw KV msg: key count disagrees with the
  // parsed messages we rendered (a row failed to parse), so a healthy admin
  // page stays clean.
  const msgDiag =
    msgKeyCount !== kvMsgs.length
      ? `<p class="sub" style="color:var(--danger)">Diagnostic: ${msgKeyCount} raw KV key(s) under msg: but ${kvMsgs.length} message(s) rendered. A row failed to parse, or the list was truncated.</p>`
      : ``;

  // Backfill control (scans tab): a one-click, resumable KV->D1 history
  // import, shown only when D1 is the live source. The status line reflects
  // the result of the last click (passed back via the PRG redirect query).
  const sp = new URL(request.url).searchParams;
  let backfillStatus = "";
  if (sp.get("bf") !== null) {
    const ok = sp.get("bfok") === "1";
    const done = sp.get("bfdone") === "1";
    const imported = esc(sp.get("bf") || "0");
    const scanned = esc(sp.get("bfscanned") || "0");
    backfillStatus = !ok
      ? `<p class="sub" style="color:var(--danger)">Backfill needs D1 enabled and KV available.</p>`
      : `<p class="sub" style="color:var(--accent)">Imported ${imported} new row(s) from ${scanned} scanned. ${
          done
            ? "History import complete."
            : "More history remains — click Import again to continue."
        }</p>`;
  }
  const backfillUI = usingD1
    ? `<form method="post" class="adm-delform" style="display:block;margin:0 0 12px">` +
      `<input type="hidden" name="action" value="backfill"/>` +
      `<button type="submit" class="adm-del">Import past scans into D1</button>` +
      `</form>` +
      backfillStatus
    : "";

  // Carry the active search through every scans-tab link/redirect so paging and
  // post-delete returns stay inside the filtered view.
  const qParam = query ? `&q=${encodeURIComponent(query)}` : "";

  // Search box (D1 only): a GET form that reloads the page with ?q=. Submitting
  // drops ?p= so results always open on page 1; a Clear link removes the filter.
  const searchUI = usingD1
    ? `<form method="get" class="adm-search" role="search">` +
      `<input type="search" name="q" value="${esc(query)}" placeholder="Search by domain or page URL (contains)" aria-label="Search scans by URL"/>` +
      `<button type="submit">Search</button>` +
      (query ? `<a class="adm-clear" href="/admin/scans#panel-scans">Clear</a>` : ``) +
      `</form>`
    : "";

  // Scans sub-line, table and pager differ by source. D1 mode: a bulk-delete
  // form (checkbox per row + select-all) and Prev/Next pagination, 100 rows a
  // page. KV stopgap: the simple per-row delete table, no paging.
  const scanSub = usingD1
    ? query
      ? `<p class="sub">${scanCount} result(s) for "${esc(query)}" · newest first · page ${pageNo + 1} of ${totalPages}</p>`
      : `<p class="sub">${scanCount} scan(s) total · newest first · page ${pageNo + 1} of ${totalPages}</p>`
    : `<p class="sub">${scanCount} most recent scans · newest first · entries expire after 90 days</p>`;

  const pageLink = (target: number, label: string): string =>
    `<a class="adm-page" href="/admin/scans?p=${target}${qParam}#panel-scans">${label}</a>`;
  const pager =
    usingD1 && totalPages > 1
      ? `<div class="adm-pager">` +
        (pageNo > 0 ? pageLink(pageNo - 1, "‹ Prev") : `<span class="adm-page is-off">‹ Prev</span>`) +
        `<span class="adm-pageinfo">Page ${pageNo + 1} / ${totalPages}</span>` +
        (pageNo < totalPages - 1 ? pageLink(pageNo + 1, "Next ›") : `<span class="adm-page is-off">Next ›</span>`) +
        `</div>`
      : "";

  const scanHeadD1 =
    `<th><input type="checkbox" id="sel-all" aria-label="select all on page"/></th>` +
    `<th>When</th><th>URL</th><th>Pages</th><th>AI</th><th>Classic</th><th>Content</th><th>Mobile</th><th>Desktop</th><th>Copied</th><th>Visits</th>`;
  const scanHeadKv =
    `<th>When</th><th>URL</th><th>Pages</th><th>AI</th><th>Classic</th><th>Content</th><th>Mobile</th><th>Desktop</th><th>Copied</th><th>Visits</th><th></th>`;

  // One "Delete selected" bar; rendered at the top and again at the bottom of
  // the page so a long page does not force a scroll back up to delete.
  const bulkBar = `<div class="adm-bulkbar"><button type="submit" class="adm-del">Delete selected</button></div>`;
  const scansTable = usingD1
    ? `<form method="post" onsubmit="if(!this.querySelector('input.adm-sel:checked')){return false;}return confirm('Delete the selected scan(s)? This also removes their share report, speed scores and engagement record.')">` +
      `<input type="hidden" name="action" value="delete-scans-bulk"/>` +
      `<input type="hidden" name="p" value="${pageNo}"/>` +
      `<input type="hidden" name="q" value="${esc(query)}"/>` +
      bulkBar +
      `<table><thead><tr>${scanHeadD1}</tr></thead><tbody>${scanRows}</tbody></table>` +
      bulkBar +
      `</form>` +
      pager +
      `<script>(function(){var a=document.getElementById('sel-all');if(!a)return;var b=document.querySelectorAll('input.adm-sel');a.addEventListener('change',function(){b.forEach(function(x){x.checked=a.checked;});});})();</script>`
    : `<table><thead><tr>${scanHeadKv}</tr></thead><tbody>${scanRows}</tbody></table>`;

  // ----- Visual reports: daily scan series for the last `chartDays` days -----
  // Bucket by UK calendar day (the date formatter handles BST/GMT) so the chart
  // days line up with the table's Europe/London timestamps. Every day in the
  // window appears, including zero-scan days, so the line keeps a true axis.
  // (A 24h step across the once-a-year DST switch can nudge a label by a day;
  // immaterial for a 30-day operator chart.)
  const ukDay = (ms: number): string =>
    new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
  const totalByDay = new Map<string, number>();
  const urlsByDay = new Map<string, Set<string>>();
  for (const r of chartRows ?? []) {
    const d = ukDay(r.at);
    totalByDay.set(d, (totalByDay.get(d) ?? 0) + 1);
    let set = urlsByDay.get(d);
    if (!set) { set = new Set(); urlsByDay.set(d, set); }
    set.add(r.url);
  }
  const dayAxis: string[] = [];
  for (let i = chartDays - 1; i >= 0; i--) dayAxis.push(ukDay(Date.now() - i * 86400000));
  const totalSeries = dayAxis.map((d) => totalByDay.get(d) ?? 0);
  const uniqueSeries = dayAxis.map((d) => urlsByDay.get(d)?.size ?? 0);

  // Dependency-free inline SVG line chart (keeps the page CSP-clean, no chart
  // library). Fixed viewBox; CSS scales it to the container width.
  const lineChartSvg = (title: string, days: string[], values: number[]): string => {
    const W = 720, H = 220, padL = 34, padR = 14, padT = 14, padB = 30;
    const n = values.length;
    const max = Math.max(1, ...values);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
    const y = (v: number) => padT + innerH * (1 - v / max);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const dots = values
      .map((v, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2"/>`)
      .join("");
    const yTicks = [0, max]
      .map((v) => {
        const yy = y(v);
        return (
          `<line class="grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>` +
          `<text class="lbl" x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${v}</text>`
        );
      })
      .join("");
    const fmtX = (d: string) => { const p = d.split("-"); return `${p[2]}/${p[1]}`; };
    const step = Math.max(1, Math.ceil(n / 6));
    let xLabels = "";
    for (let i = 0; i < n; i += step) {
      xLabels += `<text class="lbl" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtX(days[i])}</text>`;
    }
    return (
      `<figure class="adm-chart"><figcaption>${esc(title)}</figcaption>` +
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">` +
      yTicks +
      `<line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}"/>` +
      `<line class="axis" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>` +
      `<polyline class="ln" points="${pts}"/>` +
      dots + xLabels +
      `</svg></figure>`
    );
  };

  const chartCount = chartRows?.length ?? 0;
  const chartsBody = !usingD1
    ? `<p class="sub">Visual reports need D1 enabled.</p>`
    : `<p class="sub">Last ${chartDays} days · UK time · ${chartCount} scan(s) in range · reflects the current (cleaned) scan table</p>` +
      `<div class="adm-charts">` +
      lineChartSvg("Scans per day", dayAxis, totalSeries) +
      lineChartSvg("Unique URLs scanned per day", dayAxis, uniqueSeries) +
      `</div>`;

  return page(
    `<h1>XEOscan admin</h1>` +
      `<div class="adm-tabs" role="tablist" aria-label="Admin sections">` +
        `<button class="adm-tab" role="tab" id="tab-scans" aria-controls="panel-scans" aria-selected="true" tabindex="0">Websites scanned <span class="adm-count">${scanCount}</span></button>` +
        `<button class="adm-tab" role="tab" id="tab-msgs" aria-controls="panel-msgs" aria-selected="false" tabindex="-1">Messages <span class="adm-count">${msgCount}</span></button>` +
        `<button class="adm-tab" role="tab" id="tab-leads" aria-controls="panel-leads" aria-selected="false" tabindex="-1">Unlock leads <span class="adm-count">${leadCount}</span></button>` +
        `<button class="adm-tab" role="tab" id="tab-charts" aria-controls="panel-charts" aria-selected="false" tabindex="-1">Visual reports</button>` +
      `</div>` +
      `<section class="adm-panel" id="panel-scans" role="tabpanel" aria-labelledby="tab-scans">` +
        searchUI +
        scanSub +
        backfillUI +
        scansTable +
      `</section>` +
      `<section class="adm-panel" id="panel-charts" role="tabpanel" aria-labelledby="tab-charts" hidden>` +
        chartsBody +
      `</section>` +
      `<section class="adm-panel" id="panel-msgs" role="tabpanel" aria-labelledby="tab-msgs" hidden>` +
        `<p class="sub">${msgCount} message(s) · newest first · entries expire after 180 days</p>` +
        msgDiag +
        `<table><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Message</th><th></th></tr></thead>` +
        `<tbody>${msgRows}</tbody></table>` +
      `</section>` +
      `<section class="adm-panel" id="panel-leads" role="tabpanel" aria-labelledby="tab-leads" hidden>` +
        `<p class="sub">${leadCount} unlock request(s) · newest first · request rows expire after 180 days; the connection token behind an email persists until deleted here</p>` +
        `<table><thead><tr><th>When</th><th>Email</th><th>Site scanned</th><th>Link opened</th><th></th></tr></thead>` +
        `<tbody>${leadRows}</tbody></table>` +
      `</section>`,
  );
};

// GDPR / operator delete actions posted by the row forms above. Same
// auth as GET (cookie, or one-off ?key=). The KV helpers are
// prefix-checked, so a tampered key value cannot delete anything
// outside the msg:/scanlog: stores.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = checkAdminAuth(request, env.ADMIN_KEY);
  if (!auth.ok) return notFound();

  let action = "";
  let k = "";
  let sel: string[] = [];
  let bulkPage = "0";
  let bulkQuery = "";
  try {
    const form = await request.formData();
    action = String(form.get("action") || "");
    k = String(form.get("k") || "");
    // Bulk delete: every ticked row posts a `sel` = share_id.
    sel = form.getAll("sel").map(String).filter(Boolean);
    bulkPage = String(form.get("p") || "0");
    // Active search, so the post-delete redirect stays in the filtered view.
    bulkQuery = String(form.get("q") || "").trim().slice(0, 200);
  } catch {}

  let panel = "panel-scans";
  if (action === "delete-msg" && k) {
    // Messages read from KV: k is the msg: key.
    await deleteContactMessage(env.SHARES, k);
    panel = "panel-msgs";
  } else if (action === "delete-scan" && k) {
    // KV stopgap row (D1 off): k is the scanlog: key. (D1-mode single + bulk
    // deletes both go through delete-scans-bulk below, by share_id.)
    await deleteScanRecord(env.SHARES, k);
  } else if (action === "delete-lead" && k) {
    // Unlock leads read from KV: k is the unlock: key (cascades to the connection).
    await deleteUnlockLead(env.SHARES, k);
    panel = "panel-leads";
  } else if (action === "delete-scans-bulk" && sel.length) {
    // Bulk D1 delete (one IN statement) + per-id KV share-data cleanup. Stay
    // on the same page after the redirect.
    await d1DeleteScans(env, sel);
    for (const id of sel) {
      try {
        await deleteScanShareData(env.SHARES, id);
      } catch {}
    }
    const pg = Math.max(0, parseInt(bulkPage, 10) || 0);
    const qp = bulkQuery ? `&q=${encodeURIComponent(bulkQuery)}` : "";
    return new Response(null, {
      status: 303,
      headers: { Location: `/admin/scans?p=${pg}${qp}#panel-scans`, "Cache-Control": "no-store" },
    });
  } else if (action === "backfill") {
    // One-time KV->D1 history import, one page per click (resumable).
    const r = await runBackfillBatch(env);
    const q = `bf=${r.imported}&bfscanned=${r.scanned}&bfdone=${r.done ? 1 : 0}&bfok=${r.ok ? 1 : 0}`;
    return new Response(null, {
      status: 303,
      headers: { Location: `/admin/scans?${q}#panel-scans`, "Cache-Control": "no-store" },
    });
  }

  // 303: re-GET the dashboard (PRG pattern) on the tab the action
  // came from, so refresh never re-submits the delete.
  return new Response(null, {
    status: 303,
    headers: { Location: `/admin/scans#${panel}`, "Cache-Control": "no-store" },
  });
};
