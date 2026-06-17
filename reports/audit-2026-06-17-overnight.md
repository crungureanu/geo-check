# Independent code review — overnight 2026-06-17

Scope: the admin/D1/backfill/content-reveal changes landed today (commits `8cdd2e9` → `447daca`).
Files: `functions/admin/scans.ts`, `functions/_lib/d1.ts`, `functions/_lib/kv.ts`,
`functions/api/r/[id].ts`, `app.js` (`revealContent`), `tests/verify-backfill.ts`.

Method: full read of each file + schema (`migrations/0001_initial_schema.sql`), traced the
bulk-delete POST path and pagination math, ran the offline test
(`node --import ./tests/register.mjs tests/verify-backfill.ts` → PASS), grepped for the
`page` shadowing regression.

## Verdict

No CRITICAL or HIGH issues. The changes are safe to ship after review. XSS surfaces are
covered by `esc()`, SQL is fully parameterised and within the 100-param limit, KV deletes are
prefix-guarded, the D1/redemption stamp is fail-soft and cannot affect the user response, and
the `revealContent` rewrite cannot loop or leave the button stuck. The 1101 `page`-shadow
regression is gone. Findings below are MEDIUM/LOW polish items, not blockers.

---

## MEDIUM

### M1. Out-of-range `?p=` renders an empty table with no "no rows" message
`functions/admin/scans.ts:271`, `:302`, `:384-388`

The D1 query offset is computed from the **raw** request page
(`offset: reqPage * PAGE_SIZE`, line 271), but the pager and "page N of M" text use the
**clamped** `pageNo = Math.min(reqPage, totalPages - 1)` (line 302). So a request like
`/admin/scans?p=999` runs `LIMIT 100 OFFSET 99900`, which returns `[]`, yet:

- `usingD1` is still `true` and `scanCount` (= total, non-zero) is truthy, so the
  `scanRows` ternary at line 384 selects `d1ScanRows`, which is the empty string. The table
  renders headers + an empty `<tbody>` with **no** "No scans logged yet." fallback row.
- The pager/subtitle still claim you are on the last valid page (`pageNo`), so the UI looks
  like the last page legitimately has zero rows.

Not a crash and operator-only, but confusing. Fix: clamp before querying. Compute the page
count first (cheap `d1Totals`) or, simpler, clamp the offset:

```ts
// after totalPages/pageNo are known, or compute pageNo from a pre-fetched total:
const offset = pageNo * PAGE_SIZE;   // use the clamped page, not reqPage
```

Since `d1Totals` currently runs *after* `d1ListScans`, the minimal change is to reorder:
fetch totals first, derive `pageNo`, then list with `offset: pageNo * PAGE_SIZE`. That also
saves a wasted deep-offset scan.

### M2. `colspan` mismatch leaves the empty/stopgap row too narrow in D1 mode
`functions/admin/scans.ts:388`

The empty-state row is hard-coded `colspan="11"`:
```ts
: `<tr><td colspan="11">No scans logged yet.</td></tr>`;
```
The D1 header (`scanHeadD1`, line 472) has **11** columns (checkbox + 10), so 11 is correct
there. The KV stopgap header (`scanHeadKv`, line 475) also has 11 columns (10 + trailing
delete `<th>`), so 11 is also correct there. This is actually fine today, but it is a latent
trap: the two headers having the same count is a coincidence, and the single shared
`colspan="11"` will silently desync if either header changes. Low-risk note rather than a bug;
consider deriving the colspan per branch. **Downgrade to LOW** — flagging only for the
maintainer.

---

## LOW

### L1. Dead handler branch: `delete-scan-d1` is never emitted by any form
`functions/admin/scans.ts:544-551`

The POST handler has a `} else if (action === "delete-scan-d1" && k) {` branch (single-row D1
delete by share_id), but **no form in the GET emits `action="delete-scan-d1"`**. The D1 scan
rows only render a checkbox (`name="sel"`); single-row deletion in D1 mode is done by ticking
one box and using "Delete selected" (`delete-scans-bulk`). The branch is harmless dead code.
Either wire a per-row delete button to it or remove it to avoid future confusion.

### L2. `content_unlocked` / lead `redeemed` light up per-person, not per-scan
`functions/_lib/d1.ts:360-362`, `:443-445`

`LEFT JOIN connections c ON c.email = s.email` sets `content_unlocked = 1` for **every** scan
that shares the redeeming email, not only the scan whose report the user actually unlocked.
`email` is `UNIQUE` in `connections`, so the join is at most 1:1 (no row fan-out, no perf
issue), and this is the documented design ("the END USER genuinely unlocked content"). Worth
stating explicitly in the report: the Content column is an identity-level signal, so a user who
unlocked once will show Content on all their scans that carry that email. If per-scan fidelity
is ever wanted, it needs a redemption keyed to share_id, not email. Behavioural note, not a
defect.

### L3. Backfill `scanned` counts keys, not rows imported; status copy is fine but cursor advances on parse-skips
`functions/admin/scans.ts:36-84`

`runBackfillBatch` lists 100 `scanlog:` keys, skips any that 404 on `get` (line 40) or fail
`JSON.parse` (line 44-46), and reports `scanned: res.keys.length` (the listed count, line 84).
The cursor advances past skipped keys (correct — they will never parse), and `done` is derived
from `list_complete`/`!cursor` (line 81). This is all correct and idempotent (verified by the
test). One subtlety: a batch where every key is skipped still reports "Imported 0 from N
scanned" and advances, which reads slightly oddly to the operator but is accurate. No change
needed.

### L4. Bulk-delete uses share-data cleanup that cannot touch non-scan keys (good), but a `legacy:` id deletes a same-named KV key if one ever existed
`functions/admin/scans.ts:559-564`, `functions/_lib/kv.ts:530-541`

`deleteScanShareData(kv, id)` deletes `kv.delete(id)`, `speedlog:${id}`, `sharestat:${id}`.
The first one, `kv.delete(id)`, is **not** prefix-guarded — it deletes whatever key equals the
raw `id`. For real share ids (`/^[A-Za-z0-9]+$/`) and `anon:`/`legacy:` synthetic ids this is
safe because no other KV store uses those exact key names (`legacy:scanlog:...`,
`anon:<ts>:<rand>`, or a 12-char base36 id never collide with `msg:`/`unlock:`/`conn:`/
`counter:`/`speedlog:`/`sharestat:`/`scanlog:` keys). So the practical blast radius is nil.
But unlike `deleteScanRecord`/`deleteContactMessage`/`deleteUnlockLead`, this helper has **no
prefix assertion at all** — it trusts the caller. Given share_id is operator-selected from a
checkbox value that originates from D1 rows, this is acceptable, but the helper's own comment
claims the KV deleters are "prefix-checked so the admin form can never be coaxed into deleting
an arbitrary KV key" (scans.ts:516-518) — that claim is now slightly overbroad, since this one
path is value-trusting. Recommend a one-line guard or a comment correcting the claim. Severity
is LOW only because the id space cannot collide with the protected stores and the action is
ADMIN_KEY-gated.

### L5. `delForm` inlines `confirmMsg` into an `onsubmit="...'${confirmMsg}'..."` without escaping
`functions/admin/scans.ts:327`

`onsubmit="return confirm('${confirmMsg}')"` interpolates the raw string. The three callers
pass constants (`SCAN_CONFIRM`/`MSG_CONFIRM`/`LEAD_CONFIRM`) with no `'`, `"`, `<`, or `\`, so
there is no injection today. It is a foot-gun if anyone later passes a dynamic/apostrophe'd
message. Not user-reachable. Note only.

---

## Confirmed-correct (skeptical checks that passed)

- **1101 `page` shadow gone.** `grep '(const|let|var)\s+page'` in `scans.ts` → no matches. The
  helper `page()` is intact; locals are `reqPage`, `pageNo`, `bulkPage`. The render-smoke test
  (test §4) invokes `onRequestGet` and asserts 200, so a re-introduced shadow would fail at
  runtime, not just compile.
- **No nested forms.** The bulk-delete `<form>` (line 479) wraps only the `<table>`; rows
  contain `<input name="sel">` checkboxes, never inner forms. `backfillUI` and the KV
  `delForm`s are siblings, not descendants, of that form. The KV stopgap table is not wrapped
  in any outer form. HTML is well-formed.
- **XSS.** Every scan/operator-derived value rendered into HTML goes through `esc()`
  (`s.url`, `s.share_id`, `s.visits`, message `name`/`email`/`message`, lead `email`/`url`).
  `numOrDash` escapes numbers too. Backfill status query params (`bf`, `bfscanned`) are
  `esc()`'d at lines 439-442. No unescaped interpolation of external data found.
- **SQL parameter binding / 100-param limit.** `d1BackfillScans` chunks `batch()` in slices of
  50 single-row statements at 14 params each (well clear of 100/stmt; batch is N separate
  statements, not one). `d1DeleteScans` caps `ids` at 100 (line 297) and builds exactly that
  many `?` placeholders, so the single `DELETE ... IN (...)` binds ≤100 params. The admin
  caller `sel` could exceed 100 (no UI cap), but the `.slice(0, 100)` in the helper bounds it;
  worst case a >100 bulk delete silently drops the overflow — operator-only, acceptable, and
  the KV cleanup loop (scans.ts:560) iterates the full `sel`, so KV side is fully cleaned even
  past 100. Minor asymmetry, not a correctness bug.
- **Idempotency.** `INSERT ... ON CONFLICT(share_id) DO NOTHING` everywhere; backfill counts
  `meta.changes`, so a re-run returns `imported: 0` (test §3 asserts this and that row count is
  unchanged).
- **Fail-soft.** Every D1 helper opens with `const db = d1(env); if (!db) return ...;` and
  wraps the body in `try/catch` logging to `console.error`. None can throw out. `d1(env)`
  requires both the binding and `D1_ENABLED==="1"`.
- **`api/r/[id].ts` redemption stamp is isolated.** `d1MarkConnectionRedeemed` +
  `d1StampScanEmail` run inside a `try {} catch {}` (lines 46-49) nested in the outer
  `try {} catch {}` (line 37-51). Both helpers are themselves fail-soft. The user response
  (`json({ ok:true, unlocked:true, result })` at line 52) is computed independently of these
  writes, so a D1 failure cannot change the status, body, or block the response.
  `d1StampScanEmail` only fills a blank email (`AND (email IS NULL OR email = '')`), never
  overwrites.
- **`deleteScanShareData` prefix-safety on the suffixed keys.** `speedlog:${id}` and
  `sharestat:${id}` are constructed with fixed prefixes, so those two deletes are inherently
  scoped (see L4 for the bare `kv.delete(id)` caveat).
- **Speed-score units are consistent.** Backfill multiplies the 0-1 KV `speedlog` score ×100
  (scans.ts:57-58); the live path (`api/speed.ts:200-202`) stores `Math.round(score*100)` into
  the same D1 columns. Both yield 0-100. Test §2 asserts the ×100 mapping (0.54→54, 0.67→67).
- **`revealContent` cannot loop or stick.** Every early-return path re-enables the button via
  `showErr()` (which sets `btn.disabled = false; btn.innerHTML = orig`) before returning:
  404 (line 575-577), `unlocked!==true` (585-589, then `openUnlock`), no-content (594-596), and
  the `catch` (599-601). The success path (`renderResult`) rebuilds the ladder so the button is
  replaced. The `unlocked!==true` branch clears `localStorage[CT_KEY]` *before* re-opening the
  unlock modal, so the next attempt issues a fresh token instead of re-submitting the dead one
  — no infinite loop. The two pre-fetch guards (no `ct`, no `result.id`, lines 555-556) return
  before disabling the button at all.

## Test coverage gaps (per the brief)

`tests/verify-backfill.ts` covers: D1-off no-op, fresh import + field/×100/legacy-id mapping,
cursor clear, idempotent re-run, and an `onRequestGet` render smoke that asserts 200 + presence
of the bulk-delete control and checkboxes. Gaps:

1. **No `onRequestPost` test at all.** The bulk-delete path (`delete-scans-bulk` →
   `d1DeleteScans` + per-id `deleteScanShareData` → 303 redirect carrying `p`), the backfill
   POST (303 with `bf=...` query), and the single-row `delete-scan`/`delete-lead`/`delete-msg`
   paths are untested at runtime. The mock D1 (test) does not implement `DELETE`, so a delete
   test would need to extend `apply()`. Recommend at least one POST test asserting the bulk
   delete removes the right D1 rows, runs the KV cleanup, and 303-redirects to the right page.
2. **Pagination not exercised.** No test sets `?p=` with >100 mock rows to confirm offset paging
   and the `totalPages`/`pageNo` math, nor the out-of-range case in M1.
3. **Empty-state render not exercised** (D1 returns `[]` total 0 → the colspan fallback row).
4. **Mock D1 `DELETE` is a silent no-op**, so even if a delete test were added against the
   current mock it would not verify deletion. The mock needs a `DELETE FROM scans WHERE
   share_id IN (...)` and `= ?` branch.

None of these gaps mask a defect I could find by reading, but the bulk-delete and pagination
are the two genuinely new runtime paths and are currently unverified end-to-end.
