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

function page(body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
      `<meta name="robots" content="noindex,nofollow"/>` +
      `<title>XEOscan admin</title>` +
      `<link rel="stylesheet" href="/styles.css?v=20260519f"/></head><body>` +
      `<main><div class="adm">${body}</div></main></body></html>`,
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
            `<td>${esc(m.name)}</td><td class="u">${esc(m.email)}</td>` +
            `<td class="u">${esc(m.message)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No messages.</td></tr>`;

  return page(
    `<h1>Scan log</h1>` +
      `<p class="sub">${scans.length} most recent scans · newest first · entries expire after 90 days</p>` +
      `<table><thead><tr><th>When</th><th>URL</th><th>Pages</th><th>AI</th><th>Classic</th></tr></thead>` +
      `<tbody>${scanRows}</tbody></table>` +
      `<h1 style="margin-top:48px">Contact messages</h1>` +
      `<p class="sub">${msgs.length} messages · newest first</p>` +
      `<table><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Message</th></tr></thead>` +
      `<tbody>${msgRows}</tbody></table>`,
  );
};
