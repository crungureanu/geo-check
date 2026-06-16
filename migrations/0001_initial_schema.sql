-- D1 initial schema for XEOScan (geo-check).
-- System-of-record for tabular / counted / queried / historical data.
-- The heavy report blob still lives in KV (share:<id>, 7-day TTL); D1 holds
-- the small per-scan row that powers the admin + every trend report.
--
-- Apply (preview first, then prod), per reports/d1-research-2026-06-16.md §5:
--   npx wrangler d1 migrations apply xeoscan-preview --remote
--   npx wrangler d1 migrations apply xeoscan-prod    --remote
--
-- Design notes (see reports/data-layer-redesign-plan.md §3):
--  * `overall` and `is_rescan` are NOT stored: both derive at query time.
--    overall from the pillar columns (the composite formula recalibrates
--    often; a stored value would go stale); is_rescan from a window over
--    `domain` (storing it would be a read-modify-write race).
--  * email is stored LOWERCASED everywhere so joins and identity are stable
--    ("Foo@x.com" and "foo@x.com" must be one person).
--  * dual-write inserts use INSERT ... ON CONFLICT(share_id) DO NOTHING so a
--    re-run never throws on an existing primary key.

CREATE TABLE IF NOT EXISTS scans (
  share_id   TEXT PRIMARY KEY,          -- = KV share id when stored, else legacy:<ts>:<rand>
  at         INTEGER NOT NULL,          -- epoch ms
  domain     TEXT NOT NULL,             -- registrable domain, normalised
  url        TEXT NOT NULL,             -- exact scanned URL
  email      TEXT,                      -- connection email (lowercased) when known
  pages      INTEGER,                   -- pages scanned (feeds SUM(pages) totals)
  ai         INTEGER,
  classic    INTEGER,
  content    INTEGER,
  mobile     INTEGER,                   -- speed, filled later by /api/speed
  desktop    INTEGER,
  copied     INTEGER DEFAULT 0,
  visits     INTEGER DEFAULT 0,
  kind       TEXT DEFAULT 'free'        -- 'free' | 'ai' (isolates paid scans)
);
CREATE INDEX IF NOT EXISTS idx_scans_at     ON scans(at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_domain ON scans(domain, at);
CREATE INDEX IF NOT EXISTS idx_scans_email  ON scans(email, at);

CREATE TABLE IF NOT EXISTS connections (   -- per-person email unlock identity
  token        TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  redeemed_at  INTEGER,
  ai_credits   INTEGER DEFAULT 0          -- paid AI scans remaining
);

CREATE TABLE IF NOT EXISTS ai_usage (      -- one row per paid AI scan, for the ledger
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  email      TEXT NOT NULL,
  domain     TEXT,
  share_id   TEXT,
  tokens_in  INTEGER,
  tokens_out INTEGER,
  cost_cents INTEGER
);

CREATE TABLE IF NOT EXISTS payments (      -- Stripe events -> credits granted
  id            TEXT PRIMARY KEY,          -- Stripe event/session id (idempotent)
  at            INTEGER NOT NULL,
  email         TEXT NOT NULL,
  amount_cents  INTEGER,
  credits       INTEGER,
  status        TEXT                       -- 'paid' | 'refunded' | ...
);

CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  name    TEXT,
  email   TEXT,
  message TEXT
);

CREATE TABLE IF NOT EXISTS unlock_leads (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  email    TEXT NOT NULL,
  url      TEXT,
  domain   TEXT,
  share_id TEXT
);

-- Designed now, login built later. No code reads/writes it yet.
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL,
  stripe_customer TEXT,
  plan            TEXT DEFAULT 'free'
);
