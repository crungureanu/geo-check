# XEOScan scaling & hardening plan

Written 2026-06-15 after the production incident below. Goal: make the
platform safe to deploy and able to grow (1,000+ scans/day, admin checked
many times/day) without falling over. Internal working doc. We discuss and
sequence this 2026-06-16.

---

## 0. What actually happened today (postmortem, so we fix the right thing)

**Symptom:** mid-evening, KV-backed features on xeoscan.ai collapsed, share
links 404'd, new scans were not stored, the admin scan list was empty, content
unlock failed.

**Root cause (confirmed): the free-tier Cloudflare KV daily limits were
exhausted.** The namespace metrics showed, in 24h: **Reads 137.3k (free cap
100k)** and **Writes 1.98k (free cap 1k)**. Once those caps are crossed,
Cloudflare rejects KV reads/writes for the rest of the UTC day, which takes
down every KV-backed feature at once. The heavy testing through the day
(repeated scans, each doing several KV writes) drove usage over the line.

**Why it looked like the deploy broke it:** the failure crossed the limit at
roughly the same time as the Wave 2a production push, so the timing was
coincidental. Two facts prove the code was not the cause: (1) reverting to the
last-good commit (byte-identical to the prior production code) did **not** fix
it; (2) upgrading to **Workers Paid** (removes the daily caps) **did** fix it.

**Fix applied today:** upgraded the account to Workers Paid ($5/mo, account-wide,
covers Workers/Pages/KV for all projects). Service recovered within minutes.

**Still open from the incident:**
- The Wave 2a code (Lighthouse notes + og-depth/breadcrumbs recalibration) was
  reverted as a precaution and was **never actually validated on the production
  runtime**, the KV outage masked everything. It is parked on branch
  `lighthouse-notes`. It must be re-validated on a preview deploy's real
  endpoints before re-landing. We do not yet know if that code is fine; the
  revert was incident hygiene, not a verdict.
- One old report (`094c5y0z4g5x`) was lost because its write failed during the
  throttle. Re-scan to recreate if needed. Expected casualty, not a bug.

---

## 1. Bullet-proof deployment process

The core lesson: **the offline golden harness does not catch runtime, bundling,
binding, or resource-limit problems.** It froze fetch and proved scan *logic* is
unchanged, but it never exercises the Cloudflare Workers runtime, KV, the
Functions bundle, or quota limits. We shipped to prod trusting a green harness
and had no runtime safety net.

New rule: **every scanner/Functions change is validated on a preview deploy's
real endpoints before it touches production.**

### Pre-deploy checklist (preview branch -> real URL)
On `https://<branch>.geo-check.pages.dev`, with Preview env vars/bindings set
(KV `SHARES`, `PAGESPEED_API_KEY`, etc., these are scoped separately from
Production):
1. Run a real scan -> a report renders.
2. Open its share link in a clean tab -> `/api/r/:id` returns the report.
3. Run the speed test -> completes within the timeout, scores merge, no 5xx.
4. Request a content unlock -> email arrives -> link reveals content.
5. Open the admin page -> loads, shows the new rows.
6. Check the deployment's **build status** (Success) and **Workers Logs** for
   thrown exceptions during the above.

### Post-deploy safety net (production)
- Keep/extend the existing smoke workflow (`smoke.yml` / `smoke-live.mjs`) to
  probe the live KV-backed flow (scan -> share link round-trip), not just page
  presence.
- **Rollback runbook:** if prod misbehaves after a push, Cloudflare dashboard ->
  geo-check -> Deployments -> last-good deployment -> "Rollback to this
  deployment" (instant, no rebuild, KV data untouched). Document the current
  last-good commit hash in each deploy note.

### Guardrails so a deploy is never the suspect again
- Never push to `main` (production) without the preview checklist passing.
- One change-set per deploy where practical, so a regression is isolated.
- Confirm Preview AND Production bindings/env vars match before promoting
  (per-env scoping has bitten us before).

---

## 2. KV usage & limits hardening (so we never hit a wall again)

Now on Workers Paid (10M reads + 1M writes/month included, then cheap overage),
so the hard daily wall is gone. But 137k reads/day for this traffic is wasteful
and worth trimming so we stay comfortable as we grow.

- **Audit per-request KV reads.** The rate-limit and daily-cap checks likely
  read KV on every request; the admin fan-out reads hundreds per load (see
  section 3). Map every KV op per request type.
- **Cut the obvious waste:** cache hot reads at the edge where safe, collapse
  multiple reads into one, stop per-row reads in admin.
- **Add monitoring/alerting:** a daily check (or Cloudflare notification) on KV
  read/write volume and on Worker exception rate, so a spike is caught before it
  becomes an outage. (We were blind to it today.)
- **Know the new ceilings:** the Workers Paid subrequest limit is **1,000 per
  request** for the legacy bundled model, but was raised to **10,000** on the
  Standard usage model (2026-02-11); free stays 50. Correction (verified in
  reports/d1-research-2026-06-16.md): the 2026-06-15 outage was NOT the
  subrequest cap. The old admin's fan-out was ~2,300 KV reads, still well under
  10,000. The 1101 came from the **KV free-tier daily operation quota** being
  exhausted; moving to Workers Paid removed that quota. The per-row fan-out is
  still bad design and worth removing (section 3), but it was not the trigger.

---

## 3. Reporting / admin scalability redesign (the "rubbish" we are fixing)

**Current design (bad):** the admin page lists up to 500 scan-log entries and
reads each KV key individually, then fires another KV read per scan for speed
scores and another for share stats, plus the messages and leads lists. That is
~2,300 KV subrequests in a single page load. NOTE (corrected post-incident, see
reports/d1-research-2026-06-16.md): that volume did NOT breach the subrequest cap
(10,000 on the Standard usage model); the real 2026-06-15 trigger was the KV
free-tier daily operation quota running out. Either way, KV is the wrong tool for
"list and read N records to build a table", so the redesign below still stands.

**Target volume to design for:** 1,000 scans/day, 90-day retention (~90k rows),
admin viewed many times/day, with filtering/sorting/pagination.

### Recommended fix: move the scan log to Cloudflare D1 (SQL)
- One indexed query per admin view (`SELECT ... ORDER BY at DESC LIMIT n`),
  regardless of total rows. Scales to millions; viewing it 20x or 2,000x/day is
  trivial.
- Speed scores, share/engagement stats become columns or a joined table -> the
  per-row KV fan-out disappears entirely.
- Native filtering, sorting, pagination, date ranges, search.
- Proposed tables (sketch, refine tomorrow):
  - `scans(id PK, at, url, pages, ai, classic, content, mobile, desktop,
    copied, visits, created_at)`
  - `messages(id PK, at, name, email, message)`
  - `unlock_leads(id PK, at, email, url, redeemed)`
  - `connections(token PK, email, created_at, redeemed_at)` (no TTL; GDPR delete)
- Migration: dual-write to D1 alongside KV during a transition window, backfill
  recent KV rows, then cut the admin reads over to D1 and retire the KV log.
- Keep the 7-day **share reports** in KV (key-by-id reads are exactly what KV is
  good at). Only the *tabular/queryable* data moves to D1.

### Stopgap (un-break the admin first, before the D1 work)
- Cap `listScanLog` to ~100 and drop the per-row `getSpeedScores`/`getShareStat`
  joins (or make them lazy/on-demand) so total subrequests fall well under
  1,000. Buys time; not the real fix.

### Also fix while in here
- **Admin timezone bug:** dates are formatted server-side (`toLocaleString
  ("en-GB")`) in the UTC Worker, so the admin shows UTC (1h behind UK in BST).
  Fix: format with `timeZone: "Europe/London"`. (The public report page renders
  in the browser, so it already shows correct local time.)
- **Phantom speed values:** a report reportedly showed speed scores for a scan
  whose speed test was not run. Needs a clean repro (could be stale browser
  state from today's cache churn, or a real merge bug in `/api/speed`/
  `mergeResults`). Capture steps, then diagnose.

---

## 4. Admin login / auth (wanted "at some point")

**Current:** a single shared `ADMIN_KEY` passed once as `?key=`, then stored in
an HttpOnly cookie. Works, but it is one shared secret, no per-user accounts, no
audit of who did what, no easy revocation.

**Recommended: put the `/admin` route behind Cloudflare Access (zero-code).**
- Cloudflare Access sits in front of the route and requires real login (email
  one-time-PIN, Google, etc.) before the request ever reaches the Function.
- Free for small teams, no code to write/maintain, supports multiple users,
  instant revocation, and a login audit trail.
- The existing `ADMIN_KEY` check can stay as a second layer or be retired.

**Alternative (if we want it in-app):** a proper session login, username +
salted/hashed password stored in D1, server-set session cookie, login/logout
pages. More code and more to keep secure; only worth it if Access does not fit.

Recommendation: **Cloudflare Access** unless there is a reason to keep auth
in-app.

---

## 5. Suggested sequence for tomorrow

1. **Stopgap admin fix** (cap list + drop per-row joins) + **timezone fix** ->
   preview -> verify -> deploy. Gets the admin usable again, low risk.
2. **Re-validate Wave 2a** (`lighthouse-notes` branch) on a preview with the full
   real-endpoint checklist (section 1). Only re-land if clean.
3. **D1 migration** for the scan log / admin tables (the real scalability fix).
4. **Cloudflare Access** on `/admin`.
5. **KV read audit + monitoring/alerting** (section 2).
6. Tidy-ups: phantom-speed repro, KV waste reduction, re-add `signal-catalog.md`
   when Wave 2a re-lands.

## Open items carried into tomorrow
- Wave 2a code unverified in prod (branch `lighthouse-notes`); see [[phase2-built]].
- Admin Error 1101 (subrequest limit); admin timezone (UTC vs UK); phantom speed
  values (needs repro).
- D1 migration decision + schema.
- Cloudflare Access for /admin.
- KV read reduction + usage monitoring.
- Account now on Workers Paid (done today).
