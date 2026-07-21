# Offline regression harness

CI: `.github/workflows/verify.yml` runs the three fixture-free suites
(ratelimit, turnstile, ssrf) on every push. The golden suites below
need the local `fixtures/` cache and stay a local pre-merge gate.

Post-deploy: `.github/workflows/smoke.yml` probes the live site after
every successful Production deploy (`tests/smoke-live.mjs`; run it
locally with `NODE_OPTIONS=--use-system-ca node tests/smoke-live.mjs`).

Proves a refactor (Track A budget, the architecture seams, future
fixes) changes scanner output in no unintended way, with no deploy and
no network. The pipeline's only external input is HTTP, so freezing
`fetch` makes `performScan` deterministic and its findings/scores
byte-comparable.

## Run

```
# verify current code against the committed goldens (offline)
node --import ./tests/register.mjs tests/verify.ts

# re-record fixtures + goldens from live sites (network, uses curl)
node --import ./tests/register.mjs tests/record.ts [slug...]
```

`verify.ts` exits non-zero on any mismatch (use it as the pre-merge
gate for scanner-touching changes).

```
# A1: prove a tiny subrequest budget degrades gracefully (no false
# "Could not reach", truncation note present, home kept, no phantom
# fetch.failed)
node --import ./tests/register.mjs tests/verify-truncation.ts
```

Run both `verify.ts` and `verify-truncation.ts` before merging any
fetch/budget/scan change.

```
# A3: prove the global daily cap logic (pure, mock KV: fail-open on
# missing/throwing KV, exact cap boundary, UTC day rollover, env
# override resolution). The live 429 path can't be forced without
# dashboard env access, so this guards the logic.
node --import ./tests/register.mjs tests/verify-ratelimit.ts
```

```
# SSRF guard: prove the host blocklist (loopback/private/link-local/
# CGNAT/reserved IPv4+IPv6, *.local-style names, numeric-IP
# obfuscation) blocks internal targets and never blocks public hosts.
node --import ./tests/register.mjs tests/verify-ssrf.ts
```

```
# A4: prove the Turnstile gate logic (pure, mock siteverify: inert
# without a secret, reject missing/invalid token, allow valid,
# fail-open on a verify-API outage). Live path needs a dashboard
# widget + secret.
node --import ./tests/register.mjs tests/verify-turnstile.ts
```

```
# Non-HTML exclusion: prove sitemap data files (.md etc.) are never
# selected, extensionless non-HTML responses are dropped by Content-Type
# with the context.non-html-skipped note, and no-CT / failed responses
# are kept. Pure synthetic fixture.
node --import ./tests/register.mjs tests/verify-nonhtml.ts
```

```
# Heading-intent: prove which headings the extractor scores as a real
# Q&A vs an ambiguous title vs a CTA / first-person "offer of help"
# ("How can we help?"). Pure synthetic HTML, drives bar-3 citability.
node --import ./tests/register.mjs tests/verify-heading-intent.ts
```

```
# Pillar-attributed impact points: prove the per-finding pillarPoints
# invariants over the strict goldens (discipline -> pillar mapping,
# passed signals recover 0, each pillar's points sum to its score gap).
node --import ./tests/register.mjs tests/verify-impact-points.ts
```

## Layout

- `loader.mjs` / `register.mjs` resolve the codebase's extensionless
  imports so Node runs the real `.ts` source unmodified.
- `fixture-fetch.ts` record/replay shim for `globalThis.fetch`. Record
  uses `curl` as transport (this machine's Node TLS cannot verify some
  chains); replay is pure synthetic `Response`, no network.
- `sites.ts` the regression-sensitive set. `mode: "strict"` = result
  must be byte-identical to golden. `mode: "invariant"` = site sitemap
  is server-side nondeterministic (semrush, B15-4), so assert the
  properties B15 / B15-2 / B16 guarantee instead of byte-equality.
- `golden/` committed expected output (the contract; small).
- `fixtures/` gitignored local replay cache (~14MB; regenerate with
  `record`).

## When goldens legitimately change

If a change is *meant* to alter output, re-run `record`, eyeball the
golden diff in the PR, and commit the new goldens with the change.
