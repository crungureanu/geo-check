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
  opts: { limit?: number; offset?: number } = {},
): Promise<AdminScanRow[] | null> {
  const db = d1(env);
  if (!db) return null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  try {
    const res = await db
      .prepare(
        `SELECT s.share_id, s.at, s.domain, s.url, s.email, s.pages, s.ai, s.classic,
                s.content, s.mobile, s.desktop, s.copied, s.visits, s.kind,
                CASE WHEN c.redeemed_at IS NOT NULL THEN 1 ELSE 0 END AS content_unlocked
         FROM scans s
         LEFT JOIN connections c ON c.email = s.email
         ORDER BY s.at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<AdminScanRow>();
    return res.results ?? [];
  } catch (e) {
    console.error("d1_list_scans", e);
    return null;
  }
}

export async function d1Totals(
  env: D1Env,
): Promise<{ scans: number; pages: number } | null> {
  const db = d1(env);
  if (!db) return null;
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS scans, COALESCE(SUM(pages), 0) AS pages FROM scans`)
      .first<{ scans: number; pages: number }>();
    return row ?? { scans: 0, pages: 0 };
  } catch (e) {
    console.error("d1_totals", e);
    return null;
  }
}
