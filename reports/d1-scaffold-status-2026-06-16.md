# D1 dual-write scaffold: what shipped, what remains

Built 2026-06-16 (overnight) from `reports/d1-research-2026-06-16.md` and
`reports/data-layer-redesign-plan.md`. Branch: `d1-scaffold`.

## Principle

Everything here is a **no-op until D1 is both bound AND enabled**. The single
gate is `d1(env)` in `functions/_lib/d1.ts`: it returns the DB only when
`env.DB` exists AND `env.D1_ENABLED === "1"`. Every write is **additive and
fail-soft** (wrapped in try/catch, KV stays the source of truth). So this can
land on `main` with zero runtime effect, and be switched on later per
environment.

## Done (in this branch)

- **`migrations/0001_initial_schema.sql`** — the full schema from plan §3
  (`scans`, `connections`, `ai_usage`, `payments`, `messages`, `unlock_leads`,
  `users`) with the three `scans` indexes. `overall`/`is_rescan` are NOT stored
  (derived at query time). `IF NOT EXISTS` throughout so re-apply is safe.
- **`functions/_lib/d1.ts`** — the data-access module. Guard `d1(env)`, a v1
  `domainOf()` normaliser (host minus `www.`; NOT a true registrable domain yet,
  see below), and helpers: `d1InsertScan`, `d1UpdateSpeed`, `d1BumpVisit`,
  `d1MarkCopied`, `d1InsertMessage`, `d1InsertUnlockLeadAndConnection` (one
  `batch()`), `d1MarkConnectionRedeemed`, plus read helpers `d1ListScans`
  (with the `content_unlocked` LEFT JOIN) and `d1Totals`. All fail-soft.
- **Dual-write wiring** (all fail-soft, flag-guarded):
  - `api/scan.ts` → `d1InsertScan` (resolves the connection email when present).
  - `api/speed.ts` → `d1UpdateSpeed` (stores mobile/desktop as 0-100).
  - `api/contact.ts` → `d1InsertMessage`.
  - `api/unlock.ts` → `d1InsertUnlockLeadAndConnection` (lead + connection batch).
  - `api/r/[id].ts` → `d1BumpVisit` + `d1MarkConnectionRedeemed`.
  - `api/share/copied.ts` → `d1MarkCopied`.
  - `Env` interfaces extended with `DB?: D1Database; D1_ENABLED?: string`.

Verified offline: harness ALL GREEN (D1 path is a no-op with no binding), every
modified module loads under the type-stripping loader, `d1.ts` guard +
`domainOf` behave (`temp/d1-smoke.ts`). The D1 WRITE path itself cannot be
exercised offline (no D1 in the harness); it must be smoke-tested on a real
preview once bound — same situation as the Lighthouse path.

## Remaining (NOT done — needs live D1 to verify, so deferred)

1. **Admin read-cutover** (`functions/admin/scans.ts`). Read helpers exist in
   `d1.ts`; wire the admin to PREFER D1 (`d1ListScans`/`d1Totals`) when
   `d1(env)` is non-null, else fall back to the current KV stopgap. This is
   where the user's three asks land: the **Overall** column (compute from the
   pillar columns at render time with the report's composite formula, do NOT
   store), **content shown only for genuinely-unlocked** scans (the
   `content_unlocked` flag from the LEFT JOIN on redeemed connections), and
   **speed/copied/visits restored** (now plain columns). Untestable until D1 is
   populated, so left for the post-binding step.
2. **`api/stats.ts` cutover** to `d1Totals` (keep KV counter as fallback).
3. **Backfill** existing KV scanlog → `scans` (chunked `batch()` of single-row
   inserts, ≤100 bound params/query, `ON CONFLICT DO NOTHING`). One-off script.
4. **`domainOf` → true registrable domain** (eTLD+1) when subdomain grouping for
   the returning-user reports matters (plan §6). The v1 strip-`www` is adequate
   for now and clearly marked.
5. **Non-atomic dual-write caveat**: KV and D1 are separate stores; a KV success
   + D1 failure (or vice versa) is possible. Both sides are independently
   fail-soft, which is the accepted design (research report §1.4 / §3.8). When
   D1 becomes the source of truth, retire the KV tabular writes.

## Manual Cloudflare steps before enabling (account owner)

Full detail in `reports/d1-research-2026-06-16.md` §5. Summary:
1. `wrangler d1 create xeoscan-preview` and `xeoscan-prod` (record the ids).
2. `wrangler d1 migrations apply xeoscan-preview --remote`, then `…-prod`.
3. Dashboard → geo-check → Settings → Bindings: add D1 var **`DB`** →
   `xeoscan-preview` for Preview, `xeoscan-prod` for Production (per-env, like
   `SHARES`). Redeploy.
4. Set `D1_ENABLED=1` on **Preview** first; verify rows land
   (`wrangler d1 execute xeoscan-preview --remote --command "SELECT COUNT(*) FROM scans;"`);
   only then set it on **Production**.
5. Flip back to `D1_ENABLED=0` instantly reverts to KV-only if anything looks off.

## Doc corrections flagged by the research (do later)

- `reports/scaling-hardening-plan.md` still cites the stale "1,000 subrequest"
  cap — outdated since 2026-02-11 (now 10,000 on Paid). Add a one-line
  correction so it isn't used for sizing.
