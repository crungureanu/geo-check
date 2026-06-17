# Overnight code audit — 2026-06-16

Scope: the last few `main` landings — pillar-attributed impact points
(`67d872a`), Wave 2a Lighthouse notes (`a98c9ed`), and the Q&A heading-intent
calibration (`17fe33b`/`b493128`/`29c25d8`). No code was modified.

Harness state at audit time: `node --import ./tests/register.mjs tests/verify.ts`
= **ALL GREEN** (6 sites). Goldens already carry `pillarPoints` (main +
content findings) and `scores.content`, so the impact-points distribution is
regression-guarded. `audits` / `lh.*` notes are **not** in any golden (offline
harness never runs PageSpeed), so the entire Lighthouse-mining path is
**uncovered** by the harness — see H1/M1.

---

## Critical

None found.

---

## High

### H1 — Gate-cap inflates "recovers up to N points" into a misleading per-finding promise
`functions/_lib/scoring.ts:177-205` (`attachImpactPoints` / `distribute`), surfaced in `app.js:450-463` (`impactText`).

**What's wrong.** `distribute()` spreads a pillar's whole gap
(`100 - score`) across every recoverable finding in proportion to its raw
`w*(1-attainment)`. When the pillar score is held down by a *failed gate*
(e.g. `robots.ai-access` fail caps aiSeo at 25, or `discovery.https` at 50),
the gap is large (75 / 50) and is divided among findings that, on their own,
**cannot move the score at all** while the gate is still failing.

Simulated: AI gated to 25 (gap 75), findings `robots.ai-access`(w3,a0),
`schema.present`(w12,a0), `extract.content`(w12,a0.5):

| finding | claimed AI points | reality if fixed alone |
|---|---|---|
| schema.present | **42.9** | 0 (cap still 25) |
| extract.content | 21.4 | 0 (cap still 25) |
| robots.ai-access | 10.7 | unlocks the cap, then the others apply |

So a user reading "fixing **Structured data** recovers up to 42.9 AI SEO
points" will fix schema, re-scan, and see **no movement**, because the bot
block (or missing HTTPS) is still capping the discipline. The headline doc
comment promises these numbers are "honest"; under a failed gate they are not.

**Why it matters.** This is the single most user-facing number on each
finding card, and the failure mode (blocked crawler / no HTTPS) is exactly the
case where the tool most wants to be trusted. It also inverts priority: the
gate finding (`robots.ai-access`, w3) shows the *smallest* number (10.7) while
the thing the user should fix first looks least valuable.

**Proposed fix.** When a discipline carries an active failed gate, attribute
the *unlock* value to the gate finding and damp the rest, e.g.:
- compute the ungated weighted score (raw, no cap) as `wouldBe`;
- the gate finding's points = `wouldBe - score` (what unlocking restores);
- the remaining findings normalise against `100 - wouldBe`, not `100 - score`.

Or, more cheaply: detect that a finding has a `gateCap` + `status==="fail"`,
and for the *other* findings in that pillar cap their displayed points so the
pillar sum never exceeds `100 - wouldBe`. Either way the gate finding must
carry the bulk of the recoverable points.

**Harness would catch a regression?** Partially. Goldens pin `pillarPoints`
values, so a *change* to the distribution is caught, but no current fixture
exercises a hard-failed gate (all six sites pass `robots.ai-access` /
`discovery.https`), so the inflated numbers themselves are not asserted as
wrong. A new fixture with a `noindex`/HTTPS-down/AI-blocked home page would
lock this down.

---

## Medium

### M1 — Lighthouse-notes mining is entirely unverified offline; one untested runtime assumption
`functions/_lib/checks/lighthouse.ts:86-106`, `functions/_lib/pagespeed.ts:41-64`.

**What's wrong.** Two parts:

1. **Coverage gap.** No golden contains `audits` or `lh.*` findings (the
   offline harness never calls PageSpeed). The PSI-shape parsing
   (`data.lighthouseResult.audits[id]`), the `MinedAudit` projection, the
   `score>=0.9` pass test, the `displayValue` interpolation, and the
   speed.ts/classic-seo.ts wiring are all **unexercised** by `verify.ts`.
   A malformed real PSI shape would only ever surface in production.

2. **Runtime-safety review (manual).** I read the parse path for throw
   hazards on real PSI JSON. It is defensively coded: `audits ?? {}`,
   `typeof a.score === "number" ? … : null`, optional spreads. `lighthouseNotes`
   guards `!ps || !ps.fetched || !ps.audits` and `!a || a.score === null`.
   I found **no path that throws** on a well-formed-but-sparse PSI response.
   The `score>=0.9` binary assumption is **correct** for the six mined audit
   ids (`crawlable-anchors`, `errors-in-console`, `deprecations`,
   `inspector-issues`, `link-text`, `charset`) — all are binary
   pass/fail audits in Lighthouse, so there is no fractional-score
   mislabel risk. `score:null` (informative / notApplicable) is skipped, which
   is the intended behaviour.

**Why it matters.** The logic looks correct, but "looks correct and is
untested" is exactly how the reverted Wave 2a push (`653db2d`) broke prod. The
risk is a future PSI shape change or a Cloudflare-runtime `Response.json()`
quirk, with zero offline guard.

**Proposed fix.** Add one fixture whose `fx` map includes a recorded PSI
response for the home URL and run `performScan(..., { pageSpeed: true })` in a
new harness case (the `pageSpeed` opt already exists on `performScan`). Assert
the `lh.*` notes and `performance.mobile.audits` shape. This is the only way
to guard the path that broke prod once already.

**Harness would catch a regression?** No — that is the finding.

### M2 — KV payload growth from stored `audits` is real but bounded; verify the trim
`functions/_lib/pagespeed.ts:46-56`, stored via `performance.mobile/desktop.audits`.

**What's wrong (assessment).** The mining is correctly trimmed to the 6-id
keep-list (`MINED_AUDIT_IDS`) and to four scalar fields per audit
(`score`, `scoreDisplayMode`, `title`, optional `displayValue`). Worst case
~6 audits × 2 strategies (mobile+desktop) × a short `displayValue` ≈ a few KB.
That is well within the 25 MB KV value limit. **No bug** — but note the
`audits` block is stored on **both** `performance.mobile` and
`performance.desktop` even though only mobile drives `lighthouseNotes`
(speed.ts:159 / classic-seo.ts:253 pass `mobile`/`page.pagespeed`). The desktop
`audits` is stored and never read. Harmless, but it doubles the (small) audit
payload for no benefit.

**Proposed fix (optional).** Skip mining for the desktop strategy (pass a flag
to `fetchPageSpeed` to omit the `audits` projection when `strategy==="desktop"`),
or strip `desktop.audits` before `updateScan`. Low priority.

**Harness would catch a regression?** No (PSI not run offline).

### M3 — Gated, all-passing pillar silently drops its recoverable gap
`functions/_lib/scoring.ts:193-197`.

**What's wrong.** If every scored finding in a pillar passes (`den===0`) but
the pillar score is below 100 because a **gate** capped it, the gap
(`100 - score`) has nowhere to go: every finding gets `points: 0` and the
"why is my score capped" value is invisible on the cards. (Distinct from H1:
here there is no failing non-gate finding to attribute to.) Example: aiSeo
capped to 25 by a `robots.ai-access` fail that is itself the only AI finding
and is weight-3 — its own `w*(1-a)` is non-zero so it would carry points, so
this is narrow; it bites only when the gate finding's attainment rounds the den
to ~0 relative to a large gap. Mostly a corner of H1.

**Proposed fix.** Folded into the H1 fix (attribute unlock value to the gate
finding explicitly rather than via proportional `r`).

**Harness would catch a regression?** No fixture hits a gated pillar.

---

## Low

### L1 — Per-pillar points do not sum exactly to (100 − score)
`functions/_lib/scoring.ts:170,195` (`round1` applied independently per finding).

Each finding is rounded to 0.1 independently, so a pillar's displayed points
can sum to e.g. 9.9 instead of 10 (verified: gap 10 across 3 equal findings →
3.3+3.3+3.3). The doc comment hedges with "sum to ~(100 − score)", and the UI
never shows the pillar total, so no user-visible contradiction today. Leave as
a nit unless a pillar-total is ever displayed. **Harness: yes** (goldens pin
the rounded values).

### L2 — `HELP_OFFER_HEADING` can swallow a genuine "how can we help you do X?" tutorial question
`functions/_lib/extractor.ts:94-95`.

The `^(how|what|where)…(we|i)…[^?]*\b(help|assist)\b` branch matches any
"How can we help you index JavaScript?" style heading, excluding it from both
`qaHeadings` and `faqHeadings`. That is the intended trade-off (site-voice
"How can we help?" prompts), but it also drops legitimate informational
questions that happen to contain "help". Tested 15 cases: all CTA / site-voice
exclusions are correct; the only debatable misses are help-containing real
questions, which are rare. **Defensible as designed.** If tightened later,
require the help/assist verb to be the *main* verb (e.g. anchor it directly
after the subject: `(we|i)\s+(help|assist)\b`) so "help you index X" where
"index" is the real verb still counts. **Harness: weak** (no fixture has a
"how can we help you <verb>" heading).

### L3 — `answer.maybe-qa` note can append a "Plus N more pages" suffix via dedupe
`functions/_lib/scoring.ts:80-92`, `functions/_lib/checks/answer-shape.ts:138`.

The note id is page-suffixed (`answer.maybe-qa:${u}`), so multi-page scans
dedupe it through the same path as scored findings. All emissions are
`status:"warn"`, so the `weaker` count is 0 and the misleading
"counted proportionally in the score" suffix never actually appends to a
weight-0 note. **No live bug**, but the suffix text ("counted proportionally
in the score") would be wrong if a future status variance is introduced on this
note. Cosmetic. **Harness: yes if it ever fired** (goldens pin messages).

---

## Nit

### N1 — `score===100` (gap 0) hides the impact line on a still-failing finding
`functions/_lib/scoring.ts:193` + `app.js:451` (`filter(p => p.points > 0)`).

When a pillar is at 100, every finding gets `points:0` and `impactText` shows
no line — even a finding that is genuinely `warn`/`fail` but whose weight is
small enough that the pillar still rounded to 100. Correct in the gap sense (no
overall points to recover), just slightly odd that a "fail"-status card shows
no impact text. Verified `content.entity-statement` already does this benignly
in the golden (passed, points 0). No action needed.

### N2 — Backward-compat for 7-day-old stored reports: verified clean
`functions/_lib/types.ts:43,65,94,221`; `app.js:465-472`.

`pillarPoints`, `scores.content`, `contentFindings`, and
`performance.*.audits` are all additive-optional with explicit "no
SCHEMA_VERSION bump" rationale. `impactText` has a working fallback for reports
lacking `pillarPoints` (`app.js:465`), and `pillarTag` reads `f.pillarPoints`
defensively (`pp && pp.length === 1 && …`). A speed re-run on a pre-points
stored report calls `attachImpactPoints` and *upgrades* it in place. **No
shape-break; no schemaVersion bump needed.** Confirmed correct.

### N3 — `impactText` overall-delta math matches the hero gauge: verified correct
`app.js:450-463` vs `ladderModel`/`AREA_WEIGHT` (`app.js:275-299`).

I checked the conversion algebra. Gauge overall delta from an AI/Classic fix is
`((ΔAI+ΔClassic)/2) · 40/wSum`; `impactText` uses
`aiClassicF = (0.5·40)/wSum = 20/wSum` per pillar entry, and a "both" finding
contributes both entries, so the sum is identical. Content uses
`contentF = 25/wSum`, matching the content area weight directly. `wSum` is
recomputed per render with the same coverage gating as the gauge
(`app.js:657`). **The per-pillar→overall conversion is faithful.** No bug.

---

## Fix tonight vs defer

**Fix tonight (correctness, user-facing):**
1. **H1** — gate-cap point inflation. This actively misleads exactly the users
   with the worst sites (blocked crawler / no HTTPS) and inverts fix priority.
   Highest-value, smallest blast radius (one function, `attachImpactPoints`).
   Add the gated-home fixture in the same change so the new behaviour is pinned.

**Defer (next deploy, with care):**
2. **M1** — add a `pageSpeed:true` fixture + harness case for the Lighthouse
   path before the notes ever graduate to scored signals. This path broke prod
   once and is still completely untested offline.
3. **M2** — drop the unused `desktop.audits` from KV (trivial, do alongside M1).
4. **M3** — falls out of the H1 fix; verify together.

**Leave as-is:** L1, L2, L3, N1, N2, N3 — either documented design trade-offs
or already-correct. No schemaVersion action required for any of this batch.
