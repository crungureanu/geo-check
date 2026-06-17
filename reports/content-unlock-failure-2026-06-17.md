# Content-scan "not available for this report" — diagnosis + fix

Date: 2026-06-17 (overnight autonomous session)
Status: fix built on branch `fix-content-reveal-ux`, preview only, NOT merged.

## Symptom
On the Content tier, clicking "Run content scan" shows:
"The content scan is not available for this report." (app.js:568)

## Root cause (two real failure modes, same dead-end message)
`revealContent()` fetches `GET /api/r/:id?ct=<token>` and throws the generic
error whenever `data.result.scores.content` is not a number. Two genuinely
different situations both land there:

1. **Stale / dead `ct` token.** When the token does not validate, the server
   (`functions/api/r/[id].ts`) returns the LOCKED report: `{ ok:true, result }`
   with `content` stripped and NO `unlocked:true` flag. The browser still holds
   the old token in `localStorage.xeo_ct`, so it keeps showing "Run content
   scan", which keeps failing. Most common trigger right now: deleting an unlock
   lead in the admin cascades to delete its connection token
   (`deleteUnlockLead` -> removes `conn:<token>` + `connemail:<email>`), killing
   any browser still holding that token. Connections themselves have NO TTL
   (kv.ts getOrCreateConnection), so this is never natural expiry.

2. **Content genuinely N/A for the site.** `computeContentScore` returns `null`
   when no content signal applied (scoring.ts:149: `den <= 0`), i.e. the pages
   were blocked to our crawler or too thin. `scan.ts:382` then never sets
   `scores.content`, so even a VALID token unlocks a report that has no content
   to show. The locked UI cannot tell this apart from "locked", so it offers an
   unlock that dead-ends.

Confirmed NOT a regression from tonight's deploys: the only change to
`r/[id].ts` was `d1StampScanEmail` inside a side try/catch; it does not touch
the response. The unlocked path still returns the full `result` with content.

## Fix (frontend-only, low risk)
Rewrote `revealContent` to use the signals the server already sends:
- `res.status === 404` -> report expired (links live 7 days): clear, friendly note.
- `data.unlocked !== true` -> the token did not validate: clear the stale token
  from localStorage and re-open the unlock modal so the user re-unlocks (a fresh
  token is emailed). This is the real fix for the common case.
- `unlocked` but no `content` -> site genuinely not assessable: explain it plainly
  (blocked/thin), not as a scary error.
- otherwise render as before.

No server/response-shape change, so no schemaVersion bump. Needs the index.html
`?v=` cache-bust bump (done) so returning browsers pick up the new app.js.

## What still needs the user (morning)
Which case did you actually hit? If re-unlocking (re-enter email -> click the new
link) makes Content work, it was case 1 (dead token) and the engine is fine. If a
FRESH scan + FRESH unlock on a normal content-rich site still fails, that points
at the unlock email/token creation path and I should dig further — but unlock.ts
+ connection creation look correct, so this is the lower-probability branch.
