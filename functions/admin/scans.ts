import { listScanLog, listContactMessages } from "../_lib/kv";

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
      `<link rel="stylesheet" href="/styles.css?v=20260519n"/>` +
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
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.ADMIN_KEY || !key || !safeEqual(key, env.ADMIN_KEY)) {
    return new Response("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
    });
  }

  const scans = await listScanLog(env.SHARES, 500);
  const msgs = await listContactMessages(env.SHARES, 200);

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

  const scanRows = scans.length
    ? scans
        .map(
          (s) =>
            `<tr><td>${esc(new Date(s.at).toLocaleString("en-GB"))}</td>` +
            `<td class="u">${esc(s.url)}</td>` +
            `<td>${esc(s.pages ?? "")}</td>` +
            `<td>${esc(s.ai ?? "")}</td>` +
            `<td>${esc(s.classic ?? "")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No scans logged yet.</td></tr>`;

  const msgRows = msgs.length
    ? msgs
        .map(
          (m) =>
            `<tr><td>${esc(new Date(m.at).toLocaleString("en-GB"))}</td>` +
            `<td>${esc(m.name)}</td>` +
            `<td class="u"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td>` +
            `<td>${esc(m.message)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No messages.</td></tr>`;

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
        `<table><thead><tr><th>When</th><th>URL</th><th>Pages</th><th>AI</th><th>Classic</th></tr></thead>` +
        `<tbody>${scanRows}</tbody></table>` +
      `</section>` +
      `<section class="adm-panel" id="panel-msgs" role="tabpanel" aria-labelledby="tab-msgs" hidden>` +
        `<p class="sub">${msgs.length} message(s) · newest first · entries expire after 180 days</p>` +
        msgDiag +
        `<table><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Message</th></tr></thead>` +
        `<tbody>${msgRows}</tbody></table>` +
      `</section>`,
  );
};
