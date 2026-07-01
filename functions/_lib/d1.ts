// D1 data-access module (dual-write scaffold, behind a DISABLED flag).
//
// Contract: D1 is "on" only when BOTH the binding exists AND D1_ENABLED="1".
// Until then every helper here is a no-op, so shipping this with no binding and
// no flag changes nothing. Every write is additive and fail-soft: KV stays the
// source of truth; a missing binding or a thrown D1 error can never break a
// user-facing request. See reports/d1-research-2026-06-16.md and
// reports/data-layer-redesign-plan.md.
//
// D1 semantics relied on (verified 2026-06-16, sourced in the research report):
//  * .run()/.all() return empty results for INSERT/UPDATE; the write outcome is
//    in meta (meta.changes), never results.length.
//  * .batch([...]) is the ONLY transaction primitive: sequential, atomic, rolls
//    back wholesale if any statement throws. No interactive transactions.
//  * 100 bound parameters per query: single-row inserts only (no giant
//    multi-row VALUES); bulk backfill must chunk batch() of single-row stmts.

export interface D1Env {
  DB?: D1Database;
  D1_ENABLED?: string;
}

// The single gate. Returns the live DB only when bound AND explicitly enabled.
export function d1(env: D1Env): D1Database | null {
  if (!env || !env.DB) return null; // no binding -> off
  if ((env.D1_ENABLED || "") !== "1") return null; // flag off -> off
  return env.DB;
}

// v1 domain normaliser: lowercased host minus a leading "www.". NOT a true
// registrable domain (no public-suffix list); adequate for grouping rescans of
// the same site for now. Upgrade to an eTLD+1 helper when subdomain grouping
// matters (plan §6). Never throws.
export function domainOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return (url || "").toLowerCase();
  }
}

const lc = (s: string | null | undefined): string | null =>
  s ? s.toLowerCase() : null;

// Build a "contains" LIKE pattern, escaping the SQL wildcards (% _) and the
// escape char itself so a literal underscore in a URL path matches itself
// instead of acting as a single-char wildcard. Pair with `LIKE ? ESCAPE '\'`.
function likeContains(q: string): string {
  return "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

export interface ScanRow {
  share_id: string;
  at: number;
  url: string;
  email?: string | null;
  pages?: number | null;
  ai?: number | null;
  classic?: number | null;
  content?: number | null;
  kind?: string;
}

// One row per scan. ON CONFLICT DO NOTHING so a re-run (or a dual-write after a
// KV-only retry) never throws on an existing share_id.
export async function d1InsertScan(env: D1Env, row: ScanRow): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO scans
           (share_id, at, domain, url, email, pages, ai, classic, content, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(share_id) DO NOTHING`,
      )
      .bind(
        row.share_id,
        row.at,
        domainOf(row.url),
        row.url,
        lc(row.email),
        row.pages ?? null,
        row.ai ?? null,
        row.classic ?? null,
        row.content ?? null,
        row.kind ?? "free",
      )
      .run();
  } catch (e) {
    console.error("d1_insert_scan", e);
  }
}

// One-time KV->D1 history import. Unlike d1InsertScan (live path, scan
// columns only) this carries the deferred columns too (speed/engagement)
// since the backfill reads them from their KV records. ON CONFLICT(share_id)
// DO NOTHING makes it idempotent: real ids skip an existing live row, and the
// caller hands id-less old scans a deterministic legacy:<key> id so a re-run
// never duplicates them. Batched in chunks (well under the 100-param/stmt
// limit at 14 params each). Returns the number of rows actually inserted.
export interface BackfillScanRow {
  share_id: string;
  at: number;
  url: string;
  email?: string | null;
  pages?: number | null;
  ai?: number | null;
  classic?: number | null;
  content?: number | null;
  mobile?: number | null;
  desktop?: number | null;
  copied?: number;
  visits?: number;
  kind?: string;
}

export async function d1BackfillScans(
  env: D1Env,
  rows: BackfillScanRow[],
): Promise<number> {
  const db = d1(env);
  if (!db || !rows.length) return 0;
  let inserted = 0;
  try {
    const toStmt = (r: BackfillScanRow): D1PreparedStatement =>
      db
        .prepare(
          `INSERT INTO scans
             (share_id, at, domain, url, email, pages, ai, classic, content,
              mobile, desktop, copied, visits, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(share_id) DO NOTHING`,
        )
        .bind(
          r.share_id,
          r.at,
          domainOf(r.url),
          r.url,
          lc(r.email ?? null),
          r.pages ?? null,
          r.ai ?? null,
          r.classic ?? null,
          r.content ?? null,
          r.mobile ?? null,
          r.desktop ?? null,
          r.copied ?? 0,
          r.visits ?? 0,
          r.kind ?? "free",
        );
    for (let i = 0; i < rows.length; i += 50) {
      const res = await db.batch(rows.slice(i, i + 50).map(toStmt));
      for (const r of res) inserted += (r.meta?.changes as number) ?? 0;
    }
  } catch (e) {
    console.error("d1_backfill_scans", e);
  }
  return inserted;
}

// Deferred speed scores. A no-match UPDATE is a safe no-op (meta.changes = 0)
// when the scan row was never written (stateless mode, or flag-off at scan time).
export async function d1UpdateSpeed(
  env: D1Env,
  shareId: string,
  mobile: number | null,
  desktop: number | null,
): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    await db
      .prepare(`UPDATE scans SET mobile = ?, desktop = ? WHERE share_id = ?`)
      .bind(mobile, desktop, shareId)
      .run();
  } catch (e) {
    console.error("d1_update_speed", e);
  }
}

// Atomic visit increment (replaces the racey KV read-modify-write later).
export async function d1BumpVisit(env: D1Env, shareId: string): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    await db
      .prepare(`UPDATE scans SET visits = visits + 1 WHERE share_id = ?`)
      .bind(shareId)
      .run();
  } catch (e) {
    console.error("d1_bump_visit", e);
  }
}

export async function d1MarkCopied(env: D1Env, shareId: string): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    await db
      .prepare(`UPDATE scans SET copied = 1 WHERE share_id = ?`)
      .bind(shareId)
      .run();
  } catch (e) {
    console.error("d1_mark_copied", e);
  }
}

// First-touch per-domain signal snapshot. ON CONFLICT(domain) DO NOTHING keeps
// only the first recorded scan for a domain (the caller only attempts this for
// a successful, non-blocked scan, so the first CLEAN visit wins). `signals` is
// a compact map of applicable signal id -> 1 (problem) | 0 (clean pass);
// not-applicable and speed signals are omitted by the caller. Fail-soft.
export async function d1RecordFirstSignals(
  env: D1Env,
  p: { domain: string; at: number; shareId?: string | null; signals: Record<string, 0 | 1> },
): Promise<void> {
  const db = d1(env);
  if (!db || !p.domain) return;
  try {
    await db
      .prepare(
        `INSERT INTO signal_firsts (domain, at, share_id, signals) VALUES (?, ?, ?, ?)
         ON CONFLICT(domain) DO NOTHING`,
      )
      .bind(p.domain, p.at, p.shareId ?? null, JSON.stringify(p.signals))
      .run();
  } catch (e) {
    console.error("d1_record_first_signals", e);
  }
}

// First-touch snapshots since a cutoff (by first-scan time; pass 0 for all
// time), for the signal-problem aggregate. Returns at + the raw signals JSON;
// the caller tallies applied-vs-problem per signal in JS. Capped defensively.
export async function d1SignalFirstsSince(
  env: D1Env,
  sinceMs: number,
): Promise<{ at: number; signals: string }[] | null> {
  const db = d1(env);
  if (!db) return null;
  try {
    const res = await db
      .prepare(`SELECT at, signals FROM signal_firsts WHERE at >= ? LIMIT 50000`)
      .bind(sinceMs)
      .all<{ at: number; signals: string }>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_signal_firsts_since", e);
    return null;
  }
}

export async function d1InsertMessage(
  env: D1Env,
  m: { name?: string | null; email?: string | null; message?: string | null; at?: number },
): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    await db
      .prepare(`INSERT INTO messages (at, name, email, message) VALUES (?, ?, ?, ?)`)
      .bind(m.at ?? Date.now(), m.name ?? null, lc(m.email), m.message ?? null)
      .run();
  } catch (e) {
    console.error("d1_insert_message", e);
  }
}

// Unlock: the lead row and the per-person connection identity must land
// together, so they go in ONE batch (D1's only transaction). ON CONFLICT(email)
// DO NOTHING keeps the first token for an existing identity.
export async function d1InsertUnlockLeadAndConnection(
  env: D1Env,
  p: { email: string; url?: string | null; shareId?: string | null; token?: string | null; at?: number },
): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    // Inside the try (and coerced) so a nullish email can never throw out of
    // this helper when D1 is enabled (H1, audit 2026-06-16).
    const email = (p.email || "").toLowerCase();
    const at = p.at ?? Date.now();
    const stmts = [
      db
        .prepare(`INSERT INTO unlock_leads (at, email, url, domain, share_id) VALUES (?, ?, ?, ?, ?)`)
        .bind(at, email, p.url ?? null, p.url ? domainOf(p.url) : null, p.shareId ?? null),
    ];
    if (p.token) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO connections (token, email, created_at) VALUES (?, ?, ?)
             ON CONFLICT(email) DO NOTHING`,
          )
          .bind(p.token, email, at),
      );
    }
    await db.batch(stmts);
  } catch (e) {
    console.error("d1_insert_unlock", e);
  }
}

// Stamp the unlocking email onto a scan row at redemption time. The scan
// row's email is only set at scan time when the user already held a
// connection token; a first-time unlocker (scan, then unlock) would
// otherwise leave it null, so the admin's content_unlocked JOIN (keyed on
// scans.email) would never light up for that scan. Only fills a blank email,
// never overwrites a known one. No-match / already-set is a safe no-op.
export async function d1StampScanEmail(
  env: D1Env,
  shareId: string,
  email: string,
): Promise<void> {
  const db = d1(env);
  if (!db || !shareId || !email) return;
  try {
    await db
      .prepare(
        `UPDATE scans SET email = ? WHERE share_id = ? AND (email IS NULL OR email = '')`,
      )
      .bind(email.toLowerCase(), shareId)
      .run();
  } catch (e) {
    console.error("d1_stamp_scan_email", e);
  }
}

// Operator delete (GDPR / cleanup) of one scan row by its share id. A
// no-match DELETE is a safe no-op. The KV side (share blob, speed log,
// share-engagement) is removed separately by the admin handler.
export async function d1DeleteScan(env: D1Env, shareId: string): Promise<void> {
  const db = d1(env);
  if (!db || !shareId) return;
  try {
    await db.prepare(`DELETE FROM scans WHERE share_id = ?`).bind(shareId).run();
  } catch (e) {
    console.error("d1_delete_scan", e);
  }
}

// Bulk operator delete by share id. One statement with an IN list (capped at
// 100 ids by the caller, well under the 100-bound-param limit). A no-match id
// is a safe no-op. KV share data is removed separately by the admin handler.
export async function d1DeleteScans(env: D1Env, shareIds: string[]): Promise<void> {
  const db = d1(env);
  if (!db || !shareIds.length) return;
  try {
    const ids = shareIds.slice(0, 100);
    const placeholders = ids.map(() => "?").join(",");
    await db
      .prepare(`DELETE FROM scans WHERE share_id IN (${placeholders})`)
      .bind(...ids)
      .run();
  } catch (e) {
    console.error("d1_delete_scans", e);
  }
}

export async function d1MarkConnectionRedeemed(env: D1Env, token: string): Promise<void> {
  const db = d1(env);
  if (!db) return;
  try {
    await db
      .prepare(`UPDATE connections SET redeemed_at = ? WHERE token = ? AND redeemed_at IS NULL`)
      .bind(Date.now(), token)
      .run();
  } catch (e) {
    console.error("d1_mark_redeemed", e);
  }
}

// ----- Read helpers (for the future D1-backed admin; harmless to ship now) -----
// Not yet wired into the admin: the cutover to reading from D1 happens after the
// binding is live, the flag is on, and the KV history is backfilled.

export interface AdminScanRow {
  share_id: string;
  at: number;
  domain: string;
  url: string;
  email: string | null;
  pages: number | null;
  ai: number | null;
  classic: number | null;
  content: number | null;
  mobile: number | null;
  desktop: number | null;
  copied: number;
  visits: number;
  kind: string;
  content_unlocked: number; // 1 when the scan's email has a redeemed connection
}

// Most-recent scans, with a flag for whether the END USER genuinely unlocked
// content (their email maps to a redeemed connection). `overall` is intentionally
// NOT selected: the caller derives it from the pillar columns with the same
// composite formula the report uses (a stored value would go stale).
export async function d1ListScans(
  env: D1Env,
  opts: { limit?: number; offset?: number; q?: string } = {},
): Promise<AdminScanRow[] | null> {
  const db = d1(env);
  if (!db) return null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  // Optional "contains" search on the full URL, so typing a domain also matches
  // its sub-page scans. Bound + wildcard-escaped (no injection, no stray globs).
  const q = opts.q?.trim() || "";
  const where = q ? `WHERE s.url LIKE ? ESCAPE '\\'` : "";
  const binds = q ? [likeContains(q), limit, offset] : [limit, offset];
  try {
    const res = await db
      .prepare(
        `SELECT s.share_id, s.at, s.domain, s.url, s.email, s.pages, s.ai, s.classic,
                s.content, s.mobile, s.desktop, s.copied, s.visits, s.kind,
                CASE WHEN c.redeemed_at IS NOT NULL THEN 1 ELSE 0 END AS content_unlocked
         FROM scans s
         LEFT JOIN connections c ON c.email = s.email
         ${where}
         ORDER BY s.at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds)
      .all<AdminScanRow>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_list_scans", e);
    return null;
  }
}

// FULL scan export (admin CSV download): every row, newest first, all the
// tabular columns plus the same content_unlocked flag d1ListScans derives. No
// pagination (the admin export is a deliberate one-shot dump); capped high so a
// runaway table can never build an unbounded response. `overall` is not
// selected for the same reason as d1ListScans: the composite recalibrates, so a
// stored value would go stale. Returns null when D1 is off.
export async function d1ExportScans(env: D1Env): Promise<AdminScanRow[] | null> {
  const db = d1(env);
  if (!db) return null;
  try {
    const res = await db
      .prepare(
        `SELECT s.share_id, s.at, s.domain, s.url, s.email, s.pages, s.ai, s.classic,
                s.content, s.mobile, s.desktop, s.copied, s.visits, s.kind,
                CASE WHEN c.redeemed_at IS NOT NULL THEN 1 ELSE 0 END AS content_unlocked
         FROM scans s
         LEFT JOIN connections c ON c.email = s.email
         ORDER BY s.at DESC
         LIMIT 100000`,
      )
      .all<AdminScanRow>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_export_scans", e);
    return null;
  }
}

// Rows (timestamp + url only) since a cutoff, for the visual-reports daily
// charts. Day-bucketing + unique-URL counting happen in the caller (JS) so the
// day boundaries land in UK time and DST is handled by the date formatter.
// Capped defensively; at current volume the window is a few hundred rows.
export async function d1ScansSince(
  env: D1Env,
  sinceMs: number,
): Promise<{ at: number; url: string }[] | null> {
  const db = d1(env);
  if (!db) return null;
  try {
    const res = await db
      .prepare(`SELECT at, url FROM scans WHERE at >= ? ORDER BY at ASC LIMIT 50000`)
      .bind(sinceMs)
      .all<{ at: number; url: string }>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_scans_since", e);
    return null;
  }
}

export interface AdminMessageRow {
  id: number;
  at: number;
  name: string | null;
  email: string | null;
  message: string | null;
}

// Contact-form messages, newest first. Returns null when D1 is off so the
// admin falls back to the KV list.
export async function d1ListMessages(
  env: D1Env,
  opts: { limit?: number; offset?: number } = {},
): Promise<AdminMessageRow[] | null> {
  const db = d1(env);
  if (!db) return null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  try {
    const res = await db
      .prepare(
        `SELECT id, at, name, email, message FROM messages
         ORDER BY at DESC LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<AdminMessageRow>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_list_messages", e);
    return null;
  }
}

export async function d1DeleteMessage(env: D1Env, id: number): Promise<void> {
  const db = d1(env);
  if (!db || !Number.isFinite(id)) return;
  try {
    await db.prepare(`DELETE FROM messages WHERE id = ?`).bind(id).run();
  } catch (e) {
    console.error("d1_delete_message", e);
  }
}

export interface AdminLeadRow {
  id: number;
  at: number;
  email: string;
  url: string | null;
  domain: string | null;
  share_id: string | null;
  redeemed: number; // 1 when this email's connection has been redeemed
}

// Unlock leads, newest first, with the redeemed flag joined from the
// per-person connection (same identity key as the scans content_unlocked
// join). Returns null when D1 is off.
export async function d1ListUnlockLeads(
  env: D1Env,
  opts: { limit?: number; offset?: number } = {},
): Promise<AdminLeadRow[] | null> {
  const db = d1(env);
  if (!db) return null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  try {
    const res = await db
      .prepare(
        `SELECT l.id, l.at, l.email, l.url, l.domain, l.share_id,
                CASE WHEN c.redeemed_at IS NOT NULL THEN 1 ELSE 0 END AS redeemed
         FROM unlock_leads l
         LEFT JOIN connections c ON c.email = l.email
         ORDER BY l.at DESC LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<AdminLeadRow>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_list_unlock_leads", e);
    return null;
  }
}

// Delete one lead by id, and (matching the KV cascade) the per-person
// connection behind its email, so the operator delete revokes the unlock.
// Both in one atomic batch.
export async function d1DeleteUnlockLead(env: D1Env, id: number): Promise<void> {
  const db = d1(env);
  if (!db || !Number.isFinite(id)) return;
  try {
    const row = await db
      .prepare(`SELECT email FROM unlock_leads WHERE id = ?`)
      .bind(id)
      .first<{ email: string | null }>();
    const stmts = [db.prepare(`DELETE FROM unlock_leads WHERE id = ?`).bind(id)];
    if (row?.email) {
      stmts.push(
        db.prepare(`DELETE FROM connections WHERE email = ?`).bind(row.email.toLowerCase()),
      );
    }
    await db.batch(stmts);
  } catch (e) {
    console.error("d1_delete_unlock_lead", e);
  }
}

export async function d1Totals(
  env: D1Env,
  q?: string,
): Promise<{ scans: number; pages: number } | null> {
  const db = d1(env);
  if (!db) return null;
  // Same optional search filter as d1ListScans, so the paged count matches the
  // filtered rows (pagination stays correct while a search is active).
  const term = q?.trim() || "";
  const where = term ? `WHERE url LIKE ? ESCAPE '\\'` : "";
  try {
    const stmt = db.prepare(
      `SELECT COUNT(*) AS scans, COALESCE(SUM(pages), 0) AS pages FROM scans ${where}`,
    );
    const row = await (term ? stmt.bind(likeContains(term)) : stmt).first<{
      scans: number;
      pages: number;
    }>();
    return row ?? { scans: 0, pages: 0 };
  } catch (e) {
    console.error("d1_totals", e);
    return null;
  }
}
