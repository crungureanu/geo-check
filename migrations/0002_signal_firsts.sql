-- First-touch signal snapshot: one row per domain, capturing which signals
-- were NOT a clean pass on the domain's FIRST successful, non-blocked scan.
-- Powers the admin "Signal problems" aggregate (Visual reports) and a future
-- public "state of AI SEO" page: e.g. "X% of sites are missing llms.txt".
--
-- Apply (preview first, then prod), same as 0001:
--   npx wrangler d1 migrations apply xeoscan-preview --remote
--   npx wrangler d1 migrations apply xeoscan-prod    --remote
--
-- Design (decided 2026-06-19):
--  * Domain-keyed with INSERT ... ON CONFLICT(domain) DO NOTHING, so only the
--    FIRST recorded scan of a domain is kept ("what shape are sites in when
--    they first arrive"). The caller only attempts the insert for a
--    successful, non-blocked scan, so a WAF/challenge first visit is skipped
--    and the first CLEAN scan wins instead of locking in fake failures.
--  * `signals` is a compact JSON map { "<signalId>": 0|1 } where 1 = problem
--    (fail / warn / partial, i.e. anything that is not a clean pass) and
--    0 = clean pass. Not-applicable signals are omitted entirely (neither
--    numerator nor denominator). Speed signals are omitted too (PageSpeed is
--    opt-in and does not run on the default first scan).
--  * Aggregation (count applied vs problem per signal) happens in JS in the
--    admin handler; JSON tallying in SQL is not worth it at this volume.

CREATE TABLE IF NOT EXISTS signal_firsts (
  domain   TEXT PRIMARY KEY,   -- www-stripped host (same normaliser as scans.domain)
  at       INTEGER NOT NULL,   -- epoch ms of the first recorded (clean) scan
  share_id TEXT,               -- the scan that produced this snapshot, when known
  signals  TEXT NOT NULL       -- JSON: { "<signalId>": 0|1 }  (1 = problem)
);
CREATE INDEX IF NOT EXISTS idx_signal_firsts_at ON signal_firsts(at);
