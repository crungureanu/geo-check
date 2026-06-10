import {
  listScanLog,
  listContactMessages,
  getSpeedScores,
  getShareStat,
  deleteContactMessage,
  deleteScanRecord,
} from "../_lib/kv";

interface Env {
  SHARES?: KVNamespace;
  // Required secret. Set in Cloudflare Pages env vars. The page is
  // unreachable (401) until this is configured.
  ADMIN_KEY?: string;
}

const esc = (s: unknown): string =>
  String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!),
  );

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

  const scans = await listScanLog(env.SHARES, 500);
  const msgs = await listContactMessages(env.SHARES, 200);

  // Join each scan row with its phase-2 speed-log record (90-day TTL,
  // independent of the 7-day share report). Rows with no id (logged
  // before the field existed) or no speed-log entry (speed test never
  // run, or run failed) resolve to null and render as a dash.
  const speedByIndex = await Promise.all(
    scans.map((s) => (s.id ? getSpeedScores(env.SHARES, s.id) : Promise.resolve(null))),
  );
  // Same pattern as speedByIndex: per-row engagement record. Rows
  // logged before id was added, or rows whose engagement record has
  // not been written yet (link never copied AND never visited),
  // resolve to null and render as the "not copied / 0 visits" baseline.
  const shareByIndex = await Promise.all(
    scans.map((s) => (s.id ? getShareStat(env.SHARES, s.id) : Promise.resolve(null))),
  );
  // Lighthouse returns performanceScore on a 0.0-1.0 scale; surface it
  // on the human-facing 0-100 scale so the column matches what people
  // see in PageSpeed Insights.
  const fmtSpeed = (n: number | null | undefined): string =>
    typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100)) : "-";

  // Diagnostic: also fetch the raw KV key count under msg: so we can
  // tell "no messages were ever saved" (0 keys) apart from "messages
  // exist but failed to parse" (N keys, 0 messages rendered).
  let msgKeyCount = 0;
  try {
    if (env.SHARES) {
      const res: any = await env.SHARES.list({ prefix: "msg:", limit: 1000 });
      msgKeyCount = res.keys?.length ?? 0;
    }
  } catch {
    msgKeyCount = -1;
  }

  // Rows logged before share-id was stored (no s.id) cannot be joined
  // to an engagement record, so they render "-" in both columns
  // rather than the misleading "No / 0".
  const fmtCopied = (hasId: boolean, st: { copied: boolean } | null): string =>
    !hasId ? "-" : st?.copied ? "Yes" : "No";
  const fmtVisits = (hasId: boolean, st: { visits: number } | null): string =>
    !hasId ? "-" : String(st?.visits ?? 0);

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

  const scanRows = scans.length
    ? scans
        .map((s, i) => {
          const sp = speedByIndex[i];
          const sh = shareByIndex[i];
          const hasId = !!s.id;
          return (
            `<tr><td>${esc(new Date(s.at).toLocaleString("en-GB"))}</td>` +
            `<td class="u">${esc(s.url)}</td>` +
            `<td>${esc(s.pages ?? "")}</td>` +
            `<td>${esc(s.ai ?? "")}</td>` +
            `<td>${esc(s.classic ?? "")}</td>` +
            `<td>${esc(fmtSpeed(sp?.mobile))}</td>` +
            `<td>${esc(fmtSpeed(sp?.desktop))}</td>` +
            `<td>${esc(fmtCopied(hasId, sh))}</td>` +
            `<td>${esc(fmtVisits(hasId, sh))}</td>` +
            `<td>${delForm("delete-scan", s.key, SCAN_CONFIRM)}</td></tr>`
          );
        })
        .join("")
    : `<tr><td colspan="10">No scans logged yet.</td></tr>`;

  const msgRows = msgs.length
    ? msgs
        .map(
          (m) =>
            `<tr><td>${esc(new Date(m.at).toLocaleString("en-GB"))}</td>` +
            `<td>${esc(m.name)}</td>` +
            `<td class="u"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td>` +
            `<td>${esc(m.message)}</td>` +
            `<td>${delForm("delete-msg", m.key, MSG_CONFIRM)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No messages.</td></tr>`;

  // The diagnostic line only shows when something looks off (raw KV
  // keys disagree with the parsed messages we rendered) so a healthy
  // admin page stays clean.
  const msgDiag =
    msgKeyCount !== msgs.length
      ? `<p class="sub" style="color:var(--danger)">Diagnostic: ${msgKeyCount} raw KV key(s) under msg: but ${msgs.length} message(s) rendered. A row failed to parse, or the list was truncated.</p>`
      : ``;

  return page(
    `<h1>XEOscan admin</h1>` +
      `<div class="adm-tabs" role="tablist" aria-label="Admin sections">` +
        `<button class="adm-tab" role="tab" id="tab-scans" aria-controls="panel-scans" aria-selected="true" tabindex="0">Websites scanned <span class="adm-count">${scans.length}</span></button>` +
        `<button class="adm-tab" role="tab" id="tab-msgs" aria-controls="panel-msgs" aria-selected="false" tabindex="-1">Messages <span class="adm-count">${msgs.length}</span></button>` +
      `</div>` +
      `<section class="adm-panel" id="panel-scans" role="tabpanel" aria-labelledby="tab-scans">` +
        `<p class="sub">${scans.length} most recent scans · newest first · entries expire after 90 days</p>` +
        `<table><thead><tr><th>When</th><th>URL</th><th>Pages</th><th>AI</th><th>Classic</th><th>Mobile</th><th>Desktop</th><th>Copied</th><th>Visits</th><th></th></tr></thead>` +
        `<tbody>${scanRows}</tbody></table>` +
      `</section>` +
      `<section class="adm-panel" id="panel-msgs" role="tabpanel" aria-labelledby="tab-msgs" hidden>` +
        `<p class="sub">${msgs.length} message(s) · newest first · entries expire after 180 days</p>` +
        msgDiag +
        `<table><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Message</th><th></th></tr></thead>` +
        `<tbody>${msgRows}</tbody></table>` +
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
  try {
    const form = await request.formData();
    action = String(form.get("action") || "");
    k = String(form.get("k") || "");
  } catch {}

  let panel = "panel-scans";
  if (action === "delete-msg" && k) {
    await deleteContactMessage(env.SHARES, k);
    panel = "panel-msgs";
  } else if (action === "delete-scan" && k) {
    await deleteScanRecord(env.SHARES, k);
  }

  // 303: re-GET the dashboard (PRG pattern) on the tab the action
  // came from, so refresh never re-submits the delete.
  return new Response(null, {
    status: 303,
    headers: { Location: `/admin/scans#${panel}`, "Cache-Control": "no-store" },
  });
};
