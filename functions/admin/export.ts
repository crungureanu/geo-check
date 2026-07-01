// GET /admin/export -> a CSV of every scan (all tabular columns + scores) for
// download. Same auth as /admin/scans (cookie, or a one-off ?key= that is moved
// into the cookie via redirect). The file is meant to be handed to downstream
// analysis (prospecting), so it dumps the whole scans table, newest first.
import { d1ExportScans } from "../_lib/d1";
import type { AdminScanRow } from "../_lib/d1";
import { checkAdminAuth, notFound, redirectWithCookie } from "../_lib/admin-auth";

interface Env {
  SHARES?: KVNamespace;
  ADMIN_KEY?: string;
  DB?: D1Database;
  D1_ENABLED?: string;
}

// RFC-4180 field: wrap in quotes and double any embedded quote. null/undefined
// become an empty field. Numbers/booleans stringify normally.
const csvCell = (v: unknown): string => {
  if (v == null) return "";
  return `"${String(v).replace(/"/g, '""')}"`;
};

// Worker runs in UTC; give both a machine-sortable ISO stamp and a human UK one
// (matching the admin table's Europe/London display) so the export is readable
// in Excel without a timezone surprise.
const isoWhen = (at: number): string => new Date(at).toISOString();
const ukWhen = (at: number): string =>
  new Date(at).toLocaleString("en-GB", { timeZone: "Europe/London" });

const HEADERS = [
  "share_id",
  "scanned_at_iso",
  "scanned_at_uk",
  "domain",
  "url",
  "ai_score",
  "classic_score",
  "content_score",
  "content_unlocked",
  "mobile_score",
  "desktop_score",
  "pages_scanned",
  "email",
  "copied",
  "visits",
  "kind",
];

const rowCells = (s: AdminScanRow): string[] => [
  s.share_id,
  isoWhen(s.at),
  ukWhen(s.at),
  s.domain,
  s.url,
  s.ai == null ? "" : String(s.ai),
  s.classic == null ? "" : String(s.classic),
  s.content == null ? "" : String(s.content),
  s.content_unlocked ? "1" : "0",
  s.mobile == null ? "" : String(s.mobile),
  s.desktop == null ? "" : String(s.desktop),
  s.pages == null ? "" : String(s.pages),
  s.email ?? "",
  s.copied ? "1" : "0",
  s.visits == null ? "" : String(s.visits),
  s.kind ?? "",
];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = checkAdminAuth(request, env.ADMIN_KEY);
  if (!auth.ok) return notFound();
  if (auth.setCookie) return redirectWithCookie(request, env.ADMIN_KEY!);

  const rows = await d1ExportScans(env);
  if (rows === null) {
    // D1 off/unavailable: no source for the full export. Match the admin's
    // fail-soft posture rather than 500-ing.
    return new Response("Export needs D1 enabled.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  const lines = [HEADERS, ...rows.map(rowCells)].map((cells) =>
    cells.map(csvCell).join(","),
  );
  // CRLF line endings + a UTF-8 BOM so Excel opens it cleanly (correct encoding
  // for accented domains, no mangled first header cell).
  const csv = "﻿" + lines.join("\r\n") + "\r\n";

  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="xeoscan-scans-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};
