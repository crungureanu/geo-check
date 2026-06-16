# XEOScan signal catalog

Reference for everything the scanner checks, what each check is for, and why
it earns a place. Source of truth for the scoring model is
`functions/_lib/signals.ts`; this doc explains the intent behind it. Internal
working notes for now, but written cleanly so it can seed public documentation
later.

Last reviewed: 2026-06-15.

## What we focus on, and why

XEOScan scores a site for two audiences at once:

- **GEO / AI answer engines** (ChatGPT, Perplexity, Google AI Overviews, etc.).
  Internally tagged `ai-seo`. The question these signals answer is "can an AI
  read, trust, and cite this page". This is the product's differentiator, so it
  carries the most weight.
- **Classic search** (Google/Bing crawl and ranking). Internally tagged
  `classic-seo`. Table-stakes technical and on-page SEO.
- Many signals serve **both** and are tagged `both`.

Two principles shape the model:

1. **Gates before quality.** A few signals are GATES: if the site is not
   crawlable by AI, is `noindex`, or is not on HTTPS, the score is capped hard
   (`gateCap`) no matter how good the content is. This stops an empty but
   reachable site banking ~30 free points. See the `gateCap` column.
2. **Presence (bar 1) vs depth (bar 3).** Bar 1 asks "do you have it" (is there
   a title, schema, an author). Bar 3, unlocked by email, asks "is it good
   enough to get cited" (is the schema complete and verifiable, is there a
   self-contained citable passage). Bar 3 signals are scored separately and feed
   `scores.content` only.

### How scoring works (one paragraph)

Each discipline score is weighted attainment over the signals that actually
applied: `score = 100 * sum(weight * attainment) / sum(weight)`. A signal counts
only if it was emitted; signals that do not apply to a page (wrong page type,
absent content) are reported as "not applicable" and are in neither the
numerator nor the denominator. Weight reflects how much a signal matters within
its discipline. Weight-0 entries are **informational notes**: they are shown and
counted as "checks we run" but do not move the score.

## Signal counts

- **Live and scored, bar 1 + bar 2: 41** (`signals.ts` `SIGNALS`).
- **Live and scored, bar 3 content: 6** (`signals.ts` `CONTENT_SIGNALS`).
- **Live total: 47 signals.**
- **Planned (Wave 2a, browser-only audits mined from PageSpeed): 6** added to
  the "checks we run" count (see "Planned additions" below). One of these
  (`charset`) is a permanent informational note; the other five start as notes
  and become scored after calibration.
- After Wave 2a ships: **53 checks run**, of which 47 (then up to 52) are scored.

Public copy rule: round down and never claim a number ahead of what is live
("checks 45+ signals", "70+ checks across the full ladder").

---

## Live signals (bar 1 + bar 2)

Discipline key: G = GEO/AI (`ai-seo`), S = classic search (`classic-seo`),
B = both. Weight is relative importance within the discipline.

### Crawler access and indexability (gates)
Table stakes: the page loads and can be read. Passing earns little; failing caps
the score, because nothing else matters if a bot cannot reach or index the page.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `robots.ai-access` | G | 3 | cap 25 | AI crawlers (GPTBot, ClaudeBot, PerplexityBot, GrokBot, etc.) are not blocked in robots.txt. The single most important GEO gate. |
| `robots.indexable` | B | 3 | cap 20 | No `noindex` (meta or X-Robots-Tag). A noindex page cannot rank or be cited. |

### Discoverability and transport
Can the site be found and is it served securely.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `discovery.sitemap` | B | 6 | | XML sitemap is reachable. Helps crawlers find every page. |
| `discovery.https` | B | 3 | cap 50 | Served over HTTPS. A hard trust gate for search and AI. |
| `discovery.llms-txt` | G | 2 | | `llms.txt` present. Emerging convention for guiding AI crawlers. |
| `discovery.hsts` | S | 1 | | HSTS header set. Transport hardening. |
| `discovery.security-headers` | S | 1 | | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy present. |
| `discovery.mixed-content` | B | 2 | | No insecure `http://` resources on an HTTPS page. |
| `discovery.canonical` | S | 3 | | Canonical tag present. Prevents duplicate-content dilution. |
| `discovery.lang` | G | 2 | | `lang` attribute on `<html>`. Helps machines parse language. |
| `discovery.redirect` | S | 1 | | No long redirect chain to the final URL. |

### Structured data
Schema is the strongest lever for AI citation, so it is weighted heavily.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `schema.present` | G | 12 | | Any valid structured data (JSON-LD). Highest single GEO weight: schema is how AI reliably understands entities. |
| `schema.article` | G | 5 | | Article/BlogPosting schema is complete. |
| `schema.org` | G | 3 | | Organization schema is complete. |
| `schema.product` | G | 5 | | Product schema is complete. |
| `schema.faq` | G | 2 | | FAQ schema is valid. |
| `extras.identity-schema` | G | 8 | | Identity schema (Organization/Person with `sameAs`) on the home page. Anchors who the site is for AI. |

### Content substance
Is there real, extractable text and a clean structure.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `extract.content` | G | 12 | | Enough body text to cite. Tied for highest GEO weight: AI cannot cite a thin page. |
| `extract.h1` | B | 4 | | Has exactly one `<h1>`. |
| `extract.heading-hierarchy` | G | 2 | | Clean, non-skipping heading levels. |
| `extract.landmark` | G | 3 | | Content sits in a `<main>`/`<article>` landmark. |
| `extract.image-alt` | G | 3 | | Image alt-text coverage. |
| `extract.text-ratio` | G | 1 | | Reasonable text-to-code ratio (not a JS shell). |

### Citability
Signals of trust and authority that make an AI willing to quote the page.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `cite.author` | G | 6 | | Author attribution present. |
| `cite.date` | G | 5 | | Publish or update date present. |
| `cite.recency` | G | 3 | | Content is recently dated. |
| `cite.outbound` | G | 3 | | Sources its claims with outbound links. |
| `cite.internal-links` | S | 2 | | Internal linking present. |

### Answer shape
Is the content structured the way AI answer engines like to lift.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `answer.question-headings` | G | 2 | | Question-shaped headings. |
| `answer.lists` | G | 3 | | Lists or tables present (easy to extract). |
| `answer.faq-schema` | G | 2 | | Q&A marked up as FAQ schema. |

### Classic SEO
Traditional on-page and technical SEO.

| Signal | Disc | Wt | Gate | Checks / why |
|---|---|---|---|---|
| `seo.title` | S | 8 | | Title tag present and sane. |
| `seo.meta-desc` | S | 5 | | Meta description present. |
| `seo.viewport` | S | 6 | | Mobile viewport set. |
| `seo.open-graph` | B | 2 | | Open Graph tags present. |
| `seo.twitter-card` | S | 1 | | Twitter Card present. |
| `seo.favicon` | S | 1 | | Favicon present. |
| `seo.apple-touch-icon` | S | 1 | | Apple touch icon present. |
| `seo.cwv` | S | 8 | | Core Web Vitals (LCP/INP/CLS) from PageSpeed. Bar 2, runs on the speed test. |
| `seo.freshness` | B | 2 | | Visible content year is current (no stale "© 2019"). |
| `extras.home-url` | G | 1 | | Clean home URL (no tracking junk on the canonical home). |

---

## Live signals (bar 3: content depth, email-unlocked)

Scored separately and feed `scores.content` only. These ask "good enough to get
cited", not "present". Weights are relative within this catalog only.

| Signal | Disc | Wt | Checks / why |
|---|---|---|---|
| `content.citable-passage` | G | 25 | A 115-180 word self-contained answer after a question heading. The single strongest "will an AI quote this" signal. |
| `content.entity-statement` | G | 15 | A clear who/what statement in the first 300 words. |
| `content.identity-sameas` | G | 15 | `Organization.sameAs` points to verifiable identity hosts (Wikipedia, Wikidata, LinkedIn, X, GitHub, Crunchbase). |
| `content.date-modified` | G | 15 | `dateModified` is complete in Article/BlogPosting schema. |
| `content.og-depth` | G | 6 | Social-card depth (og:image absolute, dimensions, alt; twitter:card sane). Weight 6 (severity "nice"): a presentation nicety, not a citation driver, so it reads as Medium impact, not High. |
| `content.breadcrumbs` | G | 6 | BreadcrumbList schema is valid (contiguous positions). Weight 6 (severity "nice"), same reasoning as og-depth. |

---

## Planned additions (Wave 2a: browser-only PageSpeed audits)

Rationale and full analysis: `reports/redesign-tier-ladder-plan.md` plus the two
2026-06-15 independent reviews. The headline "mine ~27 Lighthouse audits" was
trimmed to the audits that (a) are not already covered by a native signal and
(b) need a real headless browser, which our static fetch cannot reproduce. These
are mined from the existing PageSpeed call by adding `&category=seo` and
`&category=best-practices` to the request (no extra API quota; some added
latency). They ship first as weight-0 notes, get calibrated against the golden
fixtures, then the discriminating ones become scored in a separate deploy.

| Planned signal | Disc | Initial | Checks / why kept |
|---|---|---|---|
| `lh.crawlable-anchors` | B | note | `<a>` with no resolvable href (JS-only navigation). On-thesis for GEO: AI bots do not run JS, so they cannot follow these. |
| `lh.errors-in-console` | S | note | JavaScript errors at load. Only obtainable from a headless run. |
| `lh.deprecations` | S | note | Use of deprecated web platform APIs. |
| `lh.inspector-issues` | S | note | Aggregated Chrome DevTools issues. |
| `lh.link-text` | B | note | Generic anchor text ("click here", "read more"). Mild SEO and extractability value. |
| `lh.charset` | B | **note (permanent)** | Character set missing or wrong. Rare, but on failure it genuinely matters for both SEO and GEO: a mis-decoded page is garbled, so neither a crawler nor an AI can extract or cite the text. Counted as a check we run, never weighted. |

These 6 raise the "checks we run" count from 47 to 53.

## What we deliberately do NOT scan, and why

Honest scope keeps the score discriminating. We rejected:

- **Lighthouse pass-by-default audits** (`doctype`, `charset` as a *scored*
  signal, `geolocation-on-start`, `notification-on-start`,
  `paste-preventing-inputs`, `image-aspect-ratio`, `image-size-responsive`).
  Almost every modern site passes these, so as weighted signals they only dilute
  the denominator without separating good sites from bad. (`charset` is kept as a
  note only, per above.)
- **Lighthouse fail-for-almost-everyone audits** (`trusted-types-xss`,
  `clickjacking-mitigation`, `origin-isolation`). Almost nobody deploys these and
  they overlap our existing `discovery.security-headers` signal.
- **Lighthouse duplicates** of signals we already score better natively
  (`document-title`, `meta-description`, `image-alt`, `canonical`, `is-on-https`,
  `is-crawlable`, `has-hsts`, `structured-data`). Re-adding them would
  double-count.
- **Anything that needs an LLM or is off-positioning**: persuasion audit, keyword
  coverage/gap analysis, Yoast-style readability scores.
- **Image weight / responsive-image audits**: their only real impact is via load
  speed and layout shift, which `seo.cwv` already measures directly.
