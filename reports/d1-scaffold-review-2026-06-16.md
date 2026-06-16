# D1 dual-write scaffold review (branch `d1-scaffold`)

Reviewed 2026-06-16. Scope: the D1 dual-write scaffold committed on branch
`d1-scaffold` (commit `0804422`), against the verified facts in
`reports/d1-research-2026-06-16.md` and the design in
`reports/data-layer-redesign-plan.md`. No code was modified.

Files reviewed: `functions/_lib/d1.ts`, `migrations/0001_initial_schema.sql`,
and the wiring in `functions/api/scan.ts`, `speed.ts`, `contact.ts`,
`unlock.ts`, `r/[id].ts`, `share/copied.ts`, plus `functions/types.d.ts`.

## How it was verified

- The scaffold is on `d1-scaffold`, NOT on `main` / the current working tree.
  Reviewed it in a throwaway `git worktree` checked out at `d1-scaffold`
  (removed afterward).
- `node --import ./tests/register.mjs tests/verify.ts` in the main working tree:
  **ALL GREEN** (6 fixtures pass). In the fresh worktree the gitignored
  fixtures are absent so it reports SKIP/ALL GREEN, which is expected.
- Loaded every D1-touched module under the type-stripping loader: all import
  cleanly, no syntax/type-strip errors. `Object.keys(d1)` exports all 11
  helpers.
- Exercised the guard directly with an empty `env` (no binding):
  `d1({}) === null`; `d1InsertScan`, `d1UpdateSpeed`,
  `d1InsertUnlockLeadAndConnection` with malformed/empty args all return
  without throwing. `domainOf('not a url') === 'not a url'`,
  `domainOf('https://WWW.Example.com/x') === 'example.com'`.
- Drove a fake DB with `D1_ENABLED:'1'` to probe the DB-ON edge cases (see
  High-1 below).

## Core claim: "true no-op when D1 is off" -> CONFIRMED

With no `DB` binding (or `D1_ENABLED != "1"`):

- `d1(env)` returns `null` first thing in every write/read helper, before any
  argument-dependent work. Confirmed empirically: every helper is a clean
  no-op with an empty env and even with malformed args.
- Every call site is additionally wrapped in its own `try { ... } catch {}`,
  and `scan.ts` further gates the helper (and the extra `getConnection` read)
  behind `if (d1(env))`. So even a thrown promise rejection cannot reach the
  user response.
- No call site evaluates an argument that can throw synchronously before the
  guard runs. The one expression that touches a possibly-undefined value
  (`p.email.toLowerCase()` in `d1InsertUnlockLeadAndConnection`) executes
  *inside* the helper, *after* the `if (!db) return;` guard, so when D1 is off
  it is never reached. (When D1 is ON it is reached but is still caught at the
  call site - see High-1.)
- The KV writes at every site are unchanged and still run first; the D1 write
  is strictly additive and downstream.

There is no path by which D1-off can change behavior or throw into a request.
The no-op claim holds.

## Findings (severity-ranked)

### Critical

None.

### High

**H1 - `d1InsertUnlockLeadAndConnection` does `p.email.toLowerCase()` outside
the try/catch; throws OUT of the helper when D1 is ON and email is nullish.**
`functions/_lib/d1.ts:160-162`. The guard `if (!db) return;` is fine, but
`const email = p.email.toLowerCase();` and `const at = p.at ?? Date.now();`
sit between the guard and the `try`. With D1 enabled and `p.email` undefined,
`.toLowerCase()` throws and the rejection propagates out of the function.
Verified empirically (fake DB, `D1_ENABLED:'1'`): "Cannot read properties of
undefined (reading 'toLowerCase')" escapes the helper.
- Risk for the no-op-off claim: **none** (guard returns before this line when
  off).
- Risk after ENABLE: low in practice - the only caller (`unlock.ts:114`)
  passes `email` only after the regex `^[^@\s]+@[^@\s]+\.[^@\s]+$` check and
  wraps the call in `try {} catch {}`, so a thrown rejection is swallowed and
  the user still gets `ok`. But it is a latent foot-gun: any future caller
  that forgets the wrapper, or any refactor that moves the email resolution,
  loses the helper's "never throws" guarantee.
- Fix: move the two `const` lines inside the `try`, or coerce defensively:
  `const email = (p.email || "").toLowerCase();` before the guard is fine too.
  Make the helper self-contained-safe like all the others.

### Medium

**M1 - `D1Database` / `D1Result` ambient types are NOT declared anywhere; this
is editor-only and will not break the build, but the "type is ambient via
workers-types" assumption in the research §4.10 is FALSE for this repo.**
`functions/types.d.ts` hand-rolls minimal Cloudflare types (`KVNamespace`,
`EventContext`, `PagesFunction`) and there is **no `@cloudflare/workers-types`
package** installed (only `sharp` et al. in `node_modules`). `D1Database`,
`D1Result`, `D1PreparedStatement` are referenced in `d1.ts` and six `Env`
interfaces but declared nowhere in-repo.
- Why it is not Critical/High: the deploy path does not type-check
  (Cloudflare's bundler strips types; the harness loader strips types via
  Node). The runtime never needs the type. Verified: every module loads and
  the harness is green. So this does NOT block the no-op merge.
- Risk: anyone opening the branch in an editor / running `tsc` sees
  `Cannot find name 'D1Database'` on ~7 files, and a future real type-check in
  CI would fail. It also means the `.bind(...)`/`.run()` call shapes are
  entirely unchecked by the compiler, so an arg-order or column-count slip
  would not be caught at author time (it would surface only on live D1).
- Fix (pick one): add `interface D1Database`, `interface D1PreparedStatement`,
  `interface D1Result` stubs to `functions/types.d.ts` mirroring the existing
  hand-rolled style (cheapest, matches repo convention); OR add
  `@cloudflare/workers-types` and a `tsconfig` that references it. The first
  matches how `KVNamespace` is already handled here.

**M2 - speed is stored 0-100 in D1 but 0-1 in the KV speedlog; intentional and
internally consistent, but flag it so it is not mistaken for a dual-write
mismatch at ENABLE/backfill time.** `functions/api/speed.ts:200-202` rounds
`performanceScore * 100` (Lighthouse `categories.performance.score` is the 0-1
fraction; confirmed in `pagespeed.ts:43,61`). The KV `logSpeedScores`
(`kv.ts:134`) stores the raw 0-1 value. So `speedlog:<id>` holds e.g. `0.79`
while `scans.mobile` holds `79`.
- This is deliberate (status report says "stored as 0-100 to match the admin
  display") and consistent with the other D1 score columns
  (`ai`/`classic`/`content` are already 0-100 integers). The admin currently
  renders "-" for speed (stopgap), and the future D1-backed admin will read
  the 0-100 column directly, so there is no live consumer reading both.
- Risk: a future backfill of historical speed from `speedlog:` into
  `scans.mobile/desktop` must `* 100` the KV 0-1 values, or it will write
  fractional 0/1 garbage. Note this in the backfill script (plan §10 step 3).
- No code fix needed in the scaffold; this is a documentation/backfill caveat.

### Low

**L1 - synthetic share_id fallback prefix is `anon:` in code vs `legacy:` in
the schema comment.** `functions/api/scan.ts:531` uses
`` `anon:${Date.now()}:${rand}` `` when KV `saveScan` returned no id (stateless
mode). The schema comment at `migrations/0001_initial_schema.sql:21` documents
the fallback as `legacy:<ts>:<rand>`, and the research §4.3 example also used
`legacy:`. Functionally fine (any unique string works as the PK; `ON CONFLICT
DO NOTHING` protects it), but the mismatch is mildly confusing for whoever
later greps the DB for synthetic rows. Pick one prefix and align the comment.
Note: the two namespaces (`legacy:` for backfill, `anon:` for stateless live)
may even be a *useful* distinction - if so, document that rather than unify.

**L2 - `d1MarkConnectionRedeemed` writes `redeemed_at` in D1 but the redeemed
column does not gate anything in the scaffold yet.** `r/[id].ts:44` mirrors the
KV `markConnectionRedeemed`. The `d1ListScans` LEFT JOIN keys
`content_unlocked` off `c.redeemed_at IS NOT NULL`. This is correct and
forward-looking, but note the JOIN is on `c.email = s.email`: a scan row whose
`email` is null (anonymous scan) never matches, so `content_unlocked = 0` for
anon scans, which is the intended semantics. No fix; called out so the ENABLE
verification checks that unlocked rows actually get `email` populated on the
scan row (they only do when `body.ct` resolved a connection at scan time -
see L3).

**L3 - `scans.email` is only populated when the user already had a connection
token at scan time (`body.ct`).** `scan.ts:526-529`. A brand-new lead who
unlocks *after* the scan gets their email written to `connections`/
`unlock_leads` but the earlier `scans` row keeps `email = null`, so the admin
`content_unlocked` JOIN will not light up for that scan. This matches the KV
behavior and is acceptable for v1, but it means "genuinely unlocked" in the
admin reflects only same-session unlocks. Worth a one-line note for whoever
builds the admin cutover so it is a known limitation, not a bug report later.

### Nits

- **N1** `domainOf` is correctly marked as a `www`-strip, not a true eTLD+1.
  Empty-string `url` yields `""`, which satisfies `domain NOT NULL` (empty
  string is non-null in SQLite). Fine for v1; already tracked as a remaining
  item.
- **N2** Read helpers `d1ListScans`/`d1Totals` return `null` (not `[]`/zeros)
  when D1 is off, which lets the future admin distinguish "D1 off -> use KV
  fallback" from "D1 on but empty". Good design; just confirm the admin cutover
  treats `null` as "fall back to KV", not "show empty".

## SQL / API correctness (all checks pass)

- **Column vs placeholder vs bind counts** (counted per statement):
  - `INSERT scans`: 10 cols / 10 `?` / 10 bind args. OK. `ON CONFLICT(share_id)
    DO NOTHING` - valid (share_id is PRIMARY KEY).
  - `UPDATE scans SET mobile=?, desktop=? WHERE share_id=?`: 3 `?` / 3 bind. OK.
  - `UPDATE scans SET visits = visits + 1 WHERE share_id=?`: atomic increment,
    1 `?` / 1 bind. OK (matches research §3.6).
  - `UPDATE scans SET copied = 1 WHERE share_id=?`: 1 `?` / 1 bind. OK.
  - `INSERT messages (at,name,email,message)`: 4 cols / 4 `?` / 4 bind. OK
    (`id` is AUTOINCREMENT, correctly omitted).
  - `INSERT unlock_leads (at,email,url,domain,share_id)`: 5 / 5 / 5. OK
    (`id` AUTOINCREMENT omitted; `email NOT NULL` always supplied).
  - `INSERT connections (token,email,created_at) ON CONFLICT(email) DO NOTHING`:
    3 / 3 / 3. OK. `ON CONFLICT(email)` target is valid (`email TEXT NOT NULL
    UNIQUE`).
  - `UPDATE connections SET redeemed_at=? WHERE token=? AND redeemed_at IS NULL`:
    2 `?` / 2 bind. OK; the `IS NULL` guard makes it first-redemption-only,
    matching KV.
  - `d1ListScans` SELECT: 2 `?` (LIMIT/OFFSET) / 2 bind. OK.
  - `d1Totals`: 0 `?`. OK.
- **NOT NULL columns always supplied**: `scans.at` (always a number:
  `Date.parse(...) || Date.now()`), `scans.domain` (`domainOf` never returns
  null - worst case `""`), `scans.url` (`result.url`). `connections.email`,
  `connections.created_at`. `unlock_leads.email`, `unlock_leads.at`. All
  satisfied.
- **Bound parameters per query**: max is 10 (`INSERT scans`), far under the
  100-parameter limit. Confirmed trivially safe.
- **`batch()` atomicity** (`d1InsertUnlockLeadAndConnection`): correct use of
  D1's only transaction primitive - lead insert + conditional connection
  upsert in one `db.batch([...])`, rolls back wholesale on failure. The
  connection statement is conditionally pushed only when `p.token` exists, so a
  tokenless call inserts just the lead. Correct.
- **Write-result handling**: no helper checks `results.length` to confirm a
  write (the research §1.4 gotcha). Writes use `.run()` and ignore the result;
  reads use `.all()`/`.first()` correctly (`.first()` -> object|null handled
  with `?? {scans:0,pages:0}`; `.all<T>()` -> `res.results ?? []`). Correct.
- **`.bind()` arg order matches `?` order** in every statement (verified
  positionally). Correct.

## Dual-write faithfulness (matches the KV writes)

- `scan.ts`: D1 `scans` row mirrors the KV `logScan` fields (url, at, pages,
  ai, classic, content) plus the resolved connection email. `kind:"free"`
  hardcoded - correct for the current free-only flow. Email resolution reuses
  `getConnection(env.SHARES, body.ct)` exactly as the existing unlock gate
  does. Faithful.
- `speed.ts`: mirrors `logSpeedScores` but as 0-100 (see M2). Faithful modulo
  the intentional scale.
- `contact.ts`: mirrors `saveContactMessage(record)` with the same name/email/
  message and `at` from the same ISO timestamp. Faithful.
- `unlock.ts`: mirrors `saveUnlockRequest` (lead) + `getOrCreateConnection`
  (token) in one batch. Faithful.
- `r/[id].ts`: `d1BumpVisit` mirrors `bumpShareVisit`; `d1MarkConnectionRedeemed`
  mirrors `markConnectionRedeemed`. Faithful.
- `share/copied.ts`: `d1MarkCopied` mirrors `markShareCopied`. Faithful.

## ENABLE-time risk review (no duplicate-row / throwing-UNIQUE traps)

- Re-running a scan with the same `share_id`: `ON CONFLICT(share_id) DO
  NOTHING` - no throw, no dup. OK.
- A returning user's second unlock (same email, new or same token):
  `connections` insert uses `ON CONFLICT(email) DO NOTHING`, so a normal second
  unlock does NOT throw on the `email UNIQUE` constraint. OK. (Note: a DIFFERENT
  token for an existing email is silently dropped - intended "keep the first
  token", matching `getOrCreateConnection` which returns the existing token.)
- `unlock_leads` has no unique constraint and an AUTOINCREMENT PK, so repeat
  unlocks legitimately append lead rows (one per request) - matches the KV
  lead log, which also appends. Intended, not a dup bug.
- Speed `UPDATE` before the scan row exists (stateless mode / flag-off at scan
  time): no-match UPDATE, `meta.changes = 0`, no throw. OK.
- The only place a thrown rejection can escape a helper is H1 (DB-ON +
  nullish email); fix that before ENABLE to keep the "never throws" contract
  literally true.

## Go / No-Go

**GO** for merging the scaffold to `main` with D1 unbound.

The core requirement - a true no-op when D1 is off - is satisfied and was
verified empirically: the guard short-circuits every helper before any
arg-dependent code, every call site is independently try/catch-wrapped, all KV
writes are unchanged, the harness is ALL GREEN, and every modified module loads.
Nothing in the off-state can change behavior or throw into a request path.

Recommended before the ENABLE phase (none block the merge):
- Fix **H1** (move `p.email.toLowerCase()` inside the try, or coerce) so the
  unlock helper keeps its never-throws guarantee independent of callers.
- Resolve **M1** by adding `D1Database`/`D1PreparedStatement`/`D1Result` stubs
  to `functions/types.d.ts` (matches the existing hand-rolled `KVNamespace`),
  so editor/CI type-checking works and `.bind()` arg slips get caught at author
  time rather than on live D1.
- Carry the **M2** 0-1 vs 0-100 note into the backfill script.
- Align the **L1** `anon:`/`legacy:` prefix comment (or document the split).
