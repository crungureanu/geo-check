# RankFix scoring rubric

The open, plain-English definition of every check RankFix runs. The source of truth lives in `apps/scanner/src/checks/`.

## How a finding works

Each check produces a `Finding` with:

- **status**: `pass` / `warn` / `fail`
- **severity**: `blocking` / `important` / `nice`
- **discipline**: `ai-seo` / `classic-seo` / `both`
- **message**: a human explanation
- **fixSnippet** (optional): copy-paste code or config

## Scoring

Each discipline starts at 100. Each finding penalises by status × severity:

| | Blocking | Important | Nice |
|---|---|---|---|
| **fail** | −25 | −10 | −3 |
| **warn** | −10 | −5 | −1 |
| **pass** | 0 | 0 | 0 |

`discipline: both` deducts from both scores. Scores clamp to 0-100.

---

## A — AI crawler access (blocking)

| ID | What it checks |
|---|---|
| `robots.missing` | `/robots.txt` is reachable. Missing is a warning, not a failure. |
| `robots.ai-bots-blocked` | Exact `Disallow: /` for any of: GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended, CCBot, Applebot-Extended, Amazonbot, Meta-ExternalAgent. |
| `robots.wildcard-blocks-ai` | `User-agent: *` with `Disallow: /` (blocks everyone). |
| `robots.x-robots-noai` | Server sends `X-Robots-Tag: noai` or `noimageai`. Unofficial signal (no W3C / IETF standard, no vendor commitment); warn only. |
| `robots.x-robots-noindex` | Server sends `X-Robots-Tag: noindex`. |
| `robots.meta-noindex` | Home page `<meta name="robots" content="noindex">`. |

## B — Discoverability & structure

| ID | What it checks |
|---|---|
| `discovery.sitemap-missing` | No `sitemap.xml` reachable at standard path or via `robots.txt`. |
| `discovery.llms-txt-missing` | No `/llms.txt`. Emerging standard; almost no one has one. Easy win. |
| `discovery.llms-txt-thin` | `/llms.txt` exists but under 50 chars. |
| `discovery.no-https` | Site served over HTTP. |
| `discovery.no-hsts` | No `Strict-Transport-Security` header. |
| `discovery.no-canonical` | Missing `<link rel="canonical">`. |
| `discovery.no-lang` | Missing `lang` attribute on `<html>`. |
| `discovery.redirect-chain` | URL needed more than one redirect to resolve. |

## C — Structured data

| ID | What it checks |
|---|---|
| `schema.none` | No JSON-LD, microdata, or RDFa on the page. |
| `schema.article-incomplete` | Article/BlogPosting/NewsArticle missing author, datePublished, or headline. |
| `schema.org-incomplete` | Organization missing name, url, logo, or sameAs. |
| `schema.product-incomplete` | Product missing name or offers. |
| `schema.faq-thin` | FAQPage with fewer than 2 questions. Note: Google deprecated FAQ rich results in 2023; value is now AI extraction only. |
| `schema.uses-microdata` | Site uses microdata/RDFa instead of JSON-LD. |

## D — Content extractability

| ID | What it checks |
|---|---|
| `extract.thin-content` | Fewer than 100 visible words in raw HTML (LLM crawlers don't run JS). |
| `extract.short-content` | 100-300 visible words. |
| `extract.no-h1` | No `<h1>`. |
| `extract.heading-skip` | Heading hierarchy skips levels (e.g. h2 → h4). |
| `extract.no-landmark` | No `<main>` or `<article>` element. |
| `extract.alt-low` | Under 50% alt-text coverage on pages with 5+ images. |
| `extract.alt-partial` | 50-90% alt coverage. |
| `extract.thin-text-ratio` | Text-to-code ratio under 5%. |

## E — Citability signals

| ID | What it checks |
|---|---|
| `cite.no-author` | No author detected via meta, JSON-LD, rel=author, or "By [Name]" patterns. Only fires on article-type pages — home/about/contact/etc. don't trigger this. |
| `cite.no-date` | No publish or modification date detected. Only fires on article-type pages. |
| `cite.no-authoritative-outbound` | No outbound links to .gov, .edu, Wikipedia, etc. (on pages with 300+ words). |
| `cite.thin-internal-links` | Home page has fewer than 5 internal links. |

## F — Answer-shape

| ID | What it checks |
|---|---|
| `answer.no-question-headings` | No h2/h3 phrased as questions on pages over 300 words. |
| `answer.no-lists` | No `<ul>`, `<ol>`, or `<table>` elements. |
| `answer.no-faq-schema` | Three or more question-shaped headings but no FAQPage JSON-LD. Nice-to-have only: Google deprecated FAQ rich results in 2023; AI extraction is the remaining benefit. |

## G — Classic SEO basics

| ID | What it checks |
|---|---|
| `seo.no-title` | No `<title>` tag. |
| `seo.title-short` | Title under 20 chars. |
| `seo.title-long` | Title over 70 chars. |
| `seo.no-meta-desc` | No meta description. |
| `seo.meta-desc-short` | Meta description under 70 chars. |
| `seo.meta-desc-long` | Meta description over 180 chars. |
| `seo.no-favicon` | No `rel="icon"` link. |
| `seo.no-apple-touch-icon` | No apple-touch-icon. |
| `seo.no-viewport` | No mobile viewport meta tag. |
| `seo.og-missing` | Two or more Open Graph tags missing on home. |
| `seo.no-twitter-card` | No twitter:card meta. |
| `seo.cwv-poor` | PageSpeed Insights performance < 0.5 (home page only). |
| `seo.cwv-mediocre` | PageSpeed Insights performance 0.5-0.75. |

## H — Free extras (generators & deep links)

| ID | What it does |
|---|---|
| `extras.home-url-querystring` | Flags home URL with query parameters. |
| `extras.next-schema` | Suggests the next-most-missing schema type with a ready-to-paste JSON-LD snippet. |
| Deep links | Generates prefilled queries to ChatGPT, Claude, Perplexity, and Google AI Mode for the user to test citation themselves. Not a check — a result-page feature. |

---

## Page-type sampler

When a site has a `sitemap.xml`, we don't scan every page. We classify each URL by path into one of:

`home`, `about`, `contact`, `service`, `product`, `article`, `faq`, `pricing`, `other`.

Then we pick one representative per available type, capped at 10 pages total. The URL the user pasted is always included.

When there's no sitemap, we scan the pasted URL and the home page only.

## Limits we accept (v1)

- We don't run JavaScript. AI bots don't either, so this is by design.
- We don't query ChatGPT/Claude/Perplexity APIs (would cost money per scan, breaking the £0 budget). The deep-links in section H let the user check citation evidence themselves for free.
- We don't crawl beyond what's in the sitemap.
- Brand-authority signals (Reddit, YouTube, Wikipedia presence) require scraping infrastructure we don't have at v1.

All of these are flagged in the [build plan](../README.md) as parked for later milestones.
