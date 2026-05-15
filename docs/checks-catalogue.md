# RankFix — Checks catalogue

This document is the authoritative list of:

1. **Active checks** — what the scanner actually evaluates today.
2. **Proposed additions** — checks and integrations we should add next, with rationale.
3. **Out of scope** — deliberately parked, with reasons.

Every "why it matters" claim in this document needs a credible source. Use Tier-1 references where possible:

- **Tier 1**: Google Search Central, Schema.org, the AI vendors' own bot/crawler docs (OpenAI, Anthropic, Google AI, Perplexity), W3C, IETF/RFCs.
- **Tier 2**: Cloudflare, Moz, Search Engine Land, academic papers, public statements from Search engineers.
- **Tier 3**: Established SEO tools' docs (Ahrefs, Semrush, Yoast) — only where Tier 1/2 don't speak to it.

Claims marked with **⚠ unverified** still need a source. The fact-check agent should hunt these down and add citations.

---

## Part 1 — Active checks (v1)

Severity: `blocking` (red, will materially hurt AI citation), `important` (orange), `nice` (grey, polish). Status: `pass` / `warn` / `fail`.

### A · AI crawler access

#### A1. robots.txt fetched (`robots.missing`)
- **What**: GET `/robots.txt` from the site origin. If unreachable, emit a `warn`.
- **Why**: Crawlers including AI bots fetch this file first to learn what they're allowed to read. A missing robots.txt defaults to "everything allowed" under RFC 9309, so it's not a hard fail — but explicit control is best practice. **Source:** [RFC 9309 — Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- **Severity**: important / warn

#### A2. 14 AI bot disallow rules (`robots.ai-bots-blocked`, `robots.wildcard-blocks-ai`)
- **What**: Parse robots.txt, check whether any of these user-agents are blocked from `/`: GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended, CCBot, Applebot-Extended, Bytespider, Amazonbot, Meta-ExternalAgent.
- **Why**: Each named bot is the published crawler identity of an AI assistant or training pipeline. A site blocking these literally cannot be cited (or, for training bots, ingested) by the corresponding AI. **Sources:** [OpenAI — Overview of OpenAI Crawlers](https://platform.openai.com/docs/bots) · [Anthropic — Does Anthropic crawl data from the web?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) · [Perplexity Crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) · [Google-Extended (Google crawlers)](https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers) · [Applebot (Apple)](https://support.apple.com/en-us/119829) · [Amazonbot](https://developer.amazon.com/amazonbot) · [CCBot (Common Crawl)](https://commoncrawl.org/ccbot)
- **Caveats discovered during fact-check**:
  - **anthropic-ai** and **Claude-Web** are deprecated UAs; the current bot is **ClaudeBot** (plus the newer **Claude-User** and **Claude-SearchBot**). Keeping `anthropic-ai` in a Disallow list is harmless but no longer load-bearing.
  - **FacebookBot** is Meta's *speech-recognition* training crawler and is rarely seen; **facebookexternalhit** (link-preview / OG fetcher) is the one publishers actually need to think about. **Meta-ExternalAgent** is Meta's LLaMA training crawler.
  - **Bytespider** and **cohere-ai** are widely reported to *not* honour robots.txt reliably ([DataDome on Bytespider](https://datadome.co/bots/bytespider/), [DataDome on cohere-ai](https://datadome.co/bots/cohere-ai/)). Flagging them in robots.txt is still worth doing, but the message should note the directive may be ignored.
- **Severity**: blocking / fail

#### A3. X-Robots-Tag header (`robots.x-robots-noai`, `robots.x-robots-noindex`)
- **What**: Inspect the response header for `noai`, `noimageai`, `noindex`.
- **Why**: `noindex` is a long-standing standard for blocking indexing. `noai` and `noimageai` were originated by DeviantArt and are **not** part of any W3C/IETF standard — vendor compliance is informal and inconsistent. The strongest opt-out remains a robots.txt Disallow for each named AI bot UA. **Sources:** [Google — X-Robots-Tag / robots meta tag spec](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) · [Am I Cited — NoAI Meta Tags](https://www.amicited.com/blog/noai-meta-tags-controlling-ai-access/) (Tier 3, but flags the lack of a formal standard)
- **Note for users**: Don't rely on `noai`/`noimageai` alone. We have no Tier-1 statement from OpenAI, Anthropic, Google or Perplexity formally committing to honour these tokens. Treat them as a *signal of intent* rather than a guaranteed block.
- **Severity**: blocking / fail (noindex); important / warn (noai / noimageai)

#### A4. Meta robots noindex on home (`robots.meta-noindex`)
- **What**: Check `<meta name="robots" content="noindex">` on the home page.
- **Why**: Authoritative way to keep a page out of indexes. On the home page, it's almost always a deployment mistake. AI search crawlers (OAI-SearchBot, ClaudeBot's search variant, PerplexityBot) generally respect the meta robots tag because their search indices mirror Google's conventions; the *training* bots will fetch a page first and only honour the directive after parsing. **Sources:** [Google — Robots meta tag, data-nosnippet, and X-Robots-Tag specifications](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) · [Anthropic — crawler docs](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- **Severity**: blocking / fail

---

### B · Discoverability & structure

#### B1. Sitemap reachable (`discovery.sitemap-missing`)
- **What**: Look for `sitemap.xml` at standard path or `Sitemap:` line in robots.txt.
- **Why**: Sitemaps tell crawlers (search engines and AI bots) where the content is. Without one, discovery relies on internal links alone. AI search crawlers do fetch sitemaps — third-party traffic studies suggest GPTBot and PerplexityBot are particularly sitemap-dependent on initial discovery — though no AI vendor has published Googlebot-style documentation on it. **Sources:** [Google — Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) · [sitemaps.org protocol](https://www.sitemaps.org/protocol.html)
- **Severity**: important / warn

#### B2. llms.txt presence (`discovery.llms-txt-missing`, `discovery.llms-txt-thin`)
- **What**: Look for `/llms.txt`; flag missing or empty (under 50 chars).
- **Why**: Proposed by Jeremy Howard in September 2024 ([llmstxt.org](https://llmstxt.org/)); has seen developer-tools adoption (Mintlify, Anthropic docs, Cursor docs) but **no major LLM vendor (OpenAI, Anthropic, Google, Perplexity) has confirmed their crawlers consume it**, and Google has publicly rejected it. Treat presence as a credibility/intent signal, not a functional citation lever. **Sources:** [llmstxt.org — the official proposal](https://llmstxt.org/) · [Search Engine Land — Meet llms.txt, a proposed standard](https://searchengineland.com/llms-txt-proposed-standard-453676)
- **Severity**: nice / warn (do not promote — evidence of consumption is still thin)

#### B3. Canonical tag (`discovery.no-canonical`)
- **What**: Look for `<link rel="canonical">`.
- **Why**: Tells crawlers which URL is authoritative when multiple URLs serve the same content. Prevents authority dilution across www/non-www, with/without trailing slashes, etc. Documented behaviour for Google; AI vendors have not published explicit guidance, so the signal is "carried through" by the fact that AI search indices are built atop the same canonicalised web. **Source:** [Google — Consolidate duplicate URLs with canonicals](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- **Severity**: nice / warn

#### B4. lang attribute (`discovery.no-lang`)
- **What**: Check `<html lang="…">`.
- **Why**: Declares content language so AI assistants know how to handle it. Required for WCAG conformance and used by search engines / assistive tech to pick the right tokenisation and TTS voice. **Sources:** [WCAG 2.1 — Language of Page (Success Criterion 3.1.1)](https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html) · [MDN — `lang` global attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/lang)
- **Severity**: nice / warn

#### B5. HTTPS + HSTS (`discovery.no-https`, `discovery.no-hsts`)
- **What**: Confirm final URL is HTTPS; check for Strict-Transport-Security header.
- **Why**: Google announced HTTPS as a (lightweight) ranking signal in 2014; modern browsers also mark plain HTTP as "not secure", which materially hurts trust. HSTS is hardening on top. **Sources:** [Google Search Central — HTTPS as a ranking signal (Aug 2014)](https://developers.google.com/search/blog/2014/08/https-as-ranking-signal) · [Google — Secure your site with HTTPS](https://developers.google.com/search/docs/advanced/security/https) · [RFC 6797 — HTTP Strict Transport Security](https://www.rfc-editor.org/rfc/rfc6797)
- **Severity**: important / fail (HTTPS); nice / warn (HSTS)

#### B6. Redirect chain length (`discovery.redirect-chain`)
- **What**: Flag if the URL requires more than one redirect to resolve.
- **Why**: Googlebot follows at most ~10 hops per fetch attempt; John Mueller has advised keeping chains under 5 hops for frequently crawled URLs. Each hop is a separate crawl request, so chains drain crawl budget. **Sources:** [Google — Redirects and Google Search](https://developers.google.com/search/docs/crawling-indexing/301-redirects) · [Search Engine Journal — Mueller on <5 hops](https://www.searchenginejournal.com/googles-john-mueller-recommends-less-than-5-hops-per-redirect-chain/344664/)
- **Severity**: nice / warn

---

### C · Structured data (JSON-LD)

#### C1. Any structured data present (`schema.none`)
- **What**: Detect presence of JSON-LD, microdata, or RDFa. If none, emit warn.
- **Why**: Structured data is how AI assistants reliably extract entity, authorship, date, and relationships. Without it, AI must rely on natural-language extraction which is noisier. Google's structured data guidelines are the de-facto standard; third-party citation studies (Semrush, BrightEdge) show schema-marked pages get cited at materially higher rates by AI assistants. **Sources:** [Google — Intro to structured data markup](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) · [Schema.org](https://schema.org/) · [Search Engine Land — Schema markup and AI search](https://searchengineland.com/schema-markup-ai-search-no-hype-472339)
- **Severity**: important / warn

#### C2. Article / BlogPosting completeness (`schema.article-incomplete`)
- **What**: For each Article/BlogPosting/NewsArticle JSON-LD block, require author, datePublished, headline.
- **Why**: Google lists `author`, `datePublished`, `dateModified`, `headline`, and `image` as the recommended properties for Article markup. Note: Google's docs explicitly say *no* property is strictly "required", but omitting any of these four sharply reduces eligibility for article rich treatment and weakens the entity record. **Sources:** [Google — Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article) · [Schema.org — Article](https://schema.org/Article)
- **Severity**: important / warn

#### C3. Organization completeness (`schema.org-incomplete`)
- **What**: For Organization JSON-LD, require name, url, logo, sameAs.
- **Why**: `sameAs` links to authoritative profiles (LinkedIn, Wikipedia, Wikidata, GitHub) — Google explicitly uses this to disambiguate entities for the Knowledge Graph, and the same Wikipedia/Wikidata anchors are what LLMs ground entity references against. **Sources:** [Google — Logo structured data](https://developers.google.com/search/docs/appearance/structured-data/logo) · [Schema.org — sameAs](https://schema.org/sameAs) · [Schema.org — Organization](https://schema.org/Organization)
- **Severity**: nice / warn

#### C4. Product completeness (`schema.product-incomplete`)
- **What**: For Product JSON-LD, require name and offers.
- **Why**: `name` and `image` are required for Product rich results; `offers` (with `price`, `priceCurrency`, `availability`) is required for merchant-listing eligibility and is what AI shopping comparisons quote. **Sources:** [Google — Product structured data (intro)](https://developers.google.com/search/docs/appearance/structured-data/product) · [Google — Merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)
- **Severity**: important / warn

#### C5. FAQPage minimum (`schema.faq-thin`)
- **What**: FAQPage with fewer than 2 Question items.
- **Why**: Important caveat from the fact-check: Google **deprecated FAQ rich results in May 2026** — they no longer appear in Google Search at all. The schema is still valid markup, and AI assistants reportedly still extract Q&A pairs from it (third-party citation studies put FAQPage among the most-cited schema types in AI Overviews), but the SEO/SERP value is essentially gone. We should reframe the message: "FAQ schema is now an AI-citation hint, not a Google rich-result lever." **Sources:** [Google Search Central Blog — Changes to HowTo and FAQ rich results (Aug 2023)](https://developers.google.com/search/blog/2023/08/howto-faq-changes) · [Search Engine Journal — Google Drops FAQ Rich Results (May 2026)](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/) · [Google — Mark Up FAQs with Structured Data](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
- **Severity**: nice / warn

#### C6. Open Graph + Twitter Card on home (`seo.og-missing`, `seo.no-twitter-card`)
- **What**: Check og:title, og:description, og:image, og:type, and twitter:card.
- **Why**: Drives previews on social, in messaging apps (Slack, iMessage, WhatsApp), and Meta's `facebookexternalhit` crawler specifically parses OG tags to generate link previews. AI source cards in ChatGPT and Perplexity often reuse OG image/title as the visible card; we have no Tier-1 vendor doc confirming this, but it's observable behaviour. **Sources:** [Open Graph protocol — ogp.me](https://ogp.me/) · [Meta — facebookexternalhit web crawler](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/) · [X (Twitter) — Cards markup reference](https://developer.x.com/en/docs/twitter-for-websites/cards/overview/markup)
- **Severity**: nice / warn

---

### D · Content extractability

#### D1. Raw-HTML word count (`extract.thin-content`, `extract.short-content`)
- **What**: Visible word count after stripping `<script>`, `<style>`, and HTML tags. Flag <100 words as fail, 100-300 as warn.
- **Why**: GPTBot, ClaudeBot and PerplexityBot fetch raw HTML and do **not** execute JavaScript — they extract what's in the initial response and move on. A client-side-rendered SPA that's empty until React mounts is functionally invisible to them, even if it ranks fine on Google (whose renderer does run JS). **Sources:** [OpenAI — Overview of OpenAI Crawlers](https://platform.openai.com/docs/bots) · [Anthropic — crawler docs](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) · [Search Engine Land — AI Search and JavaScript Rendering case study](https://www.gsqi.com/marketing-blog/ai-search-javascript-rendering/)
- **Severity**: blocking / fail (<100); important / warn (100-300)

#### D2. H1 count (`extract.no-h1`, `extract.multiple-h1`)
- **What**: Exactly one `<h1>` expected.
- **Why**: Google's John Mueller has repeatedly stated Google does **not** penalise multiple H1s, and the HTML5 spec actually permits them (one per sectioning element). Missing-H1 still matters for content extractability; multiple-H1 is closer to a style/accessibility concern than a ranking risk. We should soft-pedal the "multiple H1" warning. **Sources:** [Search Engine Land — Mueller: multiple H1s won't hurt your SEO](https://searchengineland.com/multiple-h1s-wont-get-in-the-way-of-your-seo-google-says-322909) · [MDN — Heading elements](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/Heading_Elements)
- **Severity**: important / warn (none); nice / warn (multiple — kept low-severity intentionally)

#### D3. Heading hierarchy (`extract.heading-skip`)
- **What**: Heading levels shouldn't skip (h2 → h4 is bad).
- **Why**: WCAG and HTML5 both prescribe a sequential heading outline; skipping levels breaks assistive-tech navigation and weakens the document outline that content extractors rely on. **Sources:** [WCAG — Headings and Labels (2.4.6)](https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels.html) · [W3C — Headings (Web Accessibility Tutorials)](https://www.w3.org/WAI/tutorials/page-structure/headings/)
- **Severity**: nice / warn

#### D4. Semantic landmarks (`extract.no-landmark`)
- **What**: Require `<main>` or `<article>` on the page.
- **Why**: Lets content extractors (and screen readers) separate the primary content from chrome. Readability-style extraction libraries — the same family used by many AI scraping pipelines — explicitly score `<main>` and `<article>` heavily. **Sources:** [MDN — `<main>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/main) · [HTML Living Standard — `<article>`](https://html.spec.whatwg.org/multipage/sections.html#the-article-element)
- **Severity**: nice / warn

#### D5. Image alt coverage (`extract.alt-low`, `extract.alt-partial`)
- **What**: % of images with non-empty `alt`. Flag <50% as important warn, 50-90% as nice warn (only on pages with 5+ images).
- **Why**: WCAG 1.1.1 requires text alternatives for non-text content; Google explicitly says alt text helps it understand images; and for AI assistants without on-the-fly vision (or with vision turned off for cost), alt is the only signal they have for an image's meaning. **Sources:** [WCAG — Non-text Content (1.1.1)](https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html) · [Google — Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
- **Severity**: important / warn (<50%); nice / warn (50-90%)

#### D6. Text-to-code ratio (`extract.thin-text-ratio`)
- **What**: Visible text / total HTML size. Flag if <5%.
- **Why**: Heavy framework HTML with thin visible content suggests a client-rendered SPA — the same failure mode as D1, surfaced via a different signal. Not based on a Tier-1 source; treat as a heuristic. **⚠ no credible source found** — keep as a low-severity heuristic, not a primary signal.
- **Severity**: nice / warn

---

### E · Citability signals (article pages only)

#### E1. Author byline (`cite.no-author`)
- **What**: Look for `<meta name="author">`, JSON-LD `author`, `rel="author"`, or a "By [Name]" pattern in the first ~1500 chars of visible text.
- **Why**: Google's helpful-content / E-E-A-T guidance explicitly says pages should carry a byline where one would be expected, leading to a bio with the author's credentials. AI assistants reuse the same signal: a content page with no identifiable author is harder to cite trustably. **Sources:** [Google — Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) · [Google Search Central Blog — E-E-A-T (extra "E" for Experience)](https://developers.google.com/search/blog/2022/12/google-raters-guidelines-e-e-a-t)
- **Severity**: important / warn
- **Page-type scope**: article only

#### E2. Publish / update date (`cite.no-date`)
- **What**: Look for JSON-LD datePublished/dateModified, `<time datetime>`, or article meta tags.
- **Why**: Recency signals matter to AI assistants returning current information; Google's Article structured data docs list `datePublished` and `dateModified` as recommended for the same reason. **Sources:** [Google — Article structured data (datePublished / dateModified)](https://developers.google.com/search/docs/appearance/structured-data/article) · [Schema.org — datePublished](https://schema.org/datePublished)
- **Severity**: important / warn
- **Page-type scope**: article only

#### E3. Authoritative outbound links (`cite.no-authoritative-outbound`)
- **What**: Count outbound links to .gov, .edu, .ac.*, Wikipedia, schema.org, w3.org, MDN, BBC, Reuters, AP, FT, Economist, NYT, NIH, WHO, Google Scholar, arXiv, PubMed. Flag 0 on pages with 300+ words.
- **Why**: Citing authoritative sources is part of Google's "Creating helpful content" guidance ("present information in a way that builds trust through clear sourcing"). Beyond that, the claim that AI assistants directly *weight* outbound-link authority is not backed by any Tier-1 vendor statement we could find — treat that part as a reasonable inference rather than confirmed. **Source:** [Google — Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- **Severity**: nice / warn

#### E4. Internal link density on home (`cite.thin-internal-links`)
- **What**: Flag home page with <5 internal links.
- **Why**: Internal links are how crawlers discover the rest of the site; Google's crawl-budget docs treat link discoverability as a primary input. **Source:** [Google — Crawl Budget Management For Large Sites](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget)
- **Severity**: nice / warn

---

### F · Answer-shape (pages with 300+ words)

#### F1. Question-form headings (`answer.no-question-headings`)
- **What**: Count h2/h3 starting with "what/how/why/when/where/who/which/can/does/do/is/are/will/would/should/could/did/has/have" or ending in `?`.
- **Why**: No Tier-1 vendor doc speaks to question-form headings specifically. The rationale (AI assistants find question-shaped headings easier to map to user queries) is consistent with how Google's featured snippets are extracted and how third-party AI-citation studies describe the pattern, but it remains a heuristic. **Source:** [Search Engine Land — Schema markup and AI search](https://searchengineland.com/schema-markup-ai-search-no-hype-472339) (Tier 2)
- **Severity**: nice / warn

#### F2. Lists or tables present (`answer.no-lists`)
- **What**: Presence of `<ul>`, `<ol>`, or `<table>`.
- **Why**: Independent analyses of Google AI Overviews and Perplexity citations consistently find that 40-60% of AI answers reuse list/table structure from the source, and tables in particular get cited at materially higher rates because they're directly snippable. **Sources:** [Google — Featured snippets and your website](https://developers.google.com/search/docs/appearance/featured-snippets) · [Am I Cited — Tables and Lists: When Structured Data Boosts AI Visibility](https://www.amicited.com/blog/tables-lists-structured-data-ai-visibility/) (Tier 2/3 — Tier 1 vendor research is not public)
- **Severity**: nice / warn

#### F3. FAQ schema match (`answer.no-faq-schema`)
- **What**: If a page has 3+ question-shape headings but no FAQPage JSON-LD, flag.
- **Why**: Following the May 2026 deprecation of Google's FAQ rich result, FAQPage schema is no longer an SEO/SERP lever — but it remains a clean, machine-readable Q&A structure that AI assistants reportedly extract from at high rates. Reword the user-facing message so it doesn't promise Google rich results. **Sources:** [Search Engine Journal — Google Drops FAQ Rich Results](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/) · [Google — Mark Up FAQs with Structured Data](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
- **Severity**: important / warn (consider demoting to `nice`)

---

### G · Classic SEO basics

#### G1. `<title>` length (`seo.no-title`, `seo.title-short`, `seo.title-long`)
- **What**: Require a title; ideal length 30-65 characters.
- **Why**: Title is the most heavily weighted on-page SEO element and the snippet shown in results; Google's docs explain title-link generation and the conditions that cause Google to rewrite a title. The 30-65 character window is industry consensus (titles >60 chars truncate in SERPs), not a Google-published number. **Sources:** [Google — Influencing your title links in search results](https://developers.google.com/search/docs/appearance/title-link) · [HTML Living Standard — `<title>` element](https://html.spec.whatwg.org/multipage/semantics.html#the-title-element)
- **Severity**: blocking / fail (missing); nice / warn (length)

#### G2. Meta description (`seo.no-meta-desc`, `seo.meta-desc-short`, `seo.meta-desc-long`)
- **What**: Require meta description; ideal 120-160 characters.
- **Why**: Google uses meta description as one input for the snippet shown in results (often overridden by body extraction). For AI assistants, the meta description is the most reliable "TL;DR" string available, and is frequently the text reused in ChatGPT/Perplexity source cards — observable but not Tier-1 documented. **Sources:** [Google — Control your snippets in search](https://developers.google.com/search/docs/appearance/snippet) · [Open Graph protocol — ogp.me](https://ogp.me/)
- **Severity**: important / warn (missing); nice / warn (length)

#### G3. Favicon + apple-touch-icon (`seo.no-favicon`, `seo.no-apple-touch-icon`)
- **What**: Check for `rel="icon"` and `rel="apple-touch-icon"`.
- **Why**: Google's favicon documentation specifies how favicons surface in search results and on mobile; iOS uses `apple-touch-icon` for home-screen shortcuts. AI source cards in ChatGPT and Perplexity reuse the favicon visually. **Sources:** [Google — Define a favicon to show in search results](https://developers.google.com/search/docs/appearance/favicon-in-search) · [Apple — Configuring Web Applications (apple-touch-icon)](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- **Severity**: nice / warn

#### G4. Mobile viewport (`seo.no-viewport`)
- **What**: Check for `<meta name="viewport" content="width=device-width…">`.
- **Why**: Google completed mobile-first indexing rollout on **5 July 2024** — every site is now crawled primarily with the smartphone Googlebot. Without a viewport meta tag, mobile rendering shrinks a desktop layout to fit, which Google flags as a mobile usability problem. **Sources:** [Google — Mobile-first Indexing Best Practices](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) · [Google Search Central Blog — Mobile-first is here (Oct 2023)](https://developers.google.com/search/blog/2023/10/mobile-first-is-here)
- **Severity**: important / warn

#### G5. Core Web Vitals (`seo.cwv-poor`, `seo.cwv-mediocre`)
- **What**: Via Google PageSpeed Insights API: LCP, INP, CLS, performance score.
- **Why**: Core Web Vitals are a confirmed Google page-experience input. Current "good" thresholds: LCP ≤ 2.5 s, INP ≤ 200 ms (replaced FID in March 2024), CLS ≤ 0.1, all measured at the 75th percentile. **Sources:** [web.dev — Web Vitals](https://web.dev/articles/vitals) · [Google — Understanding Core Web Vitals and Google search results](https://developers.google.com/search/docs/appearance/core-web-vitals) · [web.dev — Defining Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- **Severity**: important / fail (<0.5); nice / warn (0.5-0.75)

---

### H · Free extras (generators & deep links)

#### H1. URL hygiene on home (`extras.home-url-querystring`)
- **What**: Flag home URL with query parameters in the canonical.
- **Why**: Google's URL structure guidance prefers clean, descriptive URLs and consolidates duplicate URLs via canonicals to prevent authority dilution. **Sources:** [Google — Keep a simple URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure) · [Google — Consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- **Severity**: nice / warn

#### H2. Suggest next-most-missing schema (`extras.next-schema`)
- **What**: If Organization isn't present on home, suggest it with a copy-paste snippet.
- **Why**: Organization is the foundational entity record Google uses to anchor a brand in the Knowledge Graph; `sameAs` from Organization is the canonical place to link Wikipedia/Wikidata/social profiles, which is what LLMs use to ground entity references. **Sources:** [Google — Organization (Logo) structured data](https://developers.google.com/search/docs/appearance/structured-data/logo) · [Schema.org — Organization](https://schema.org/Organization)
- **Severity**: nice / warn

#### H3. Deep links for citation testing (not a check, a feature)
- **What**: Generates prefilled queries to ChatGPT, Claude, Perplexity, and Google AI Mode that ask "What do you know about {domain}?" — user clicks to test citation themselves.
- **Why**: We can't query LLMs for free per scan; deep links offload to the user's session at zero cost. **No verification needed — feature decision**

---

## Part 2 — Proposed additions (v2)

Each entry has a priority (P0/P1/P2) and a "why now" rationale. The fact-check agent should validate whether each is worth doing.

### I · Performance & web hygiene

#### I1. Page weight / total bytes (P1)
- **What**: Measure total transferred bytes (HTML + CSS + JS + images).
- **Why**: Heavy pages hurt LCP (a Core Web Vital) and consume crawl budget. The "1.5 MB" target in the original draft is now too aggressive: the HTTP Archive 2024 Web Almanac puts the median page at **~2.3 MB on mobile and ~2.7 MB on desktop**, so flagging at 1.5 MB would warn most of the web. A more defensible threshold is ~3 MB (mobile p75) or ≥1 MB *blocking* JS/CSS specifically. **Source:** [HTTP Archive Web Almanac 2024 — Page Weight](https://almanac.httparchive.org/en/2024/page-weight)

#### I2. Compression (`Content-Encoding`) (P1)
- **What**: Check for Brotli or gzip on text resources.
- **Why**: Standard hygiene; Google's "Enable text compression" Lighthouse audit and CWV guidance both treat uncompressed text resources as a defect. **Sources:** [web.dev — Enable text compression](https://developer.chrome.com/docs/lighthouse/performance/uses-text-compression) · [IETF RFC 7932 — Brotli Compressed Data Format](https://www.rfc-editor.org/rfc/rfc7932)

#### I3. Render-blocking resources (P1)
- **What**: Count `<script>` and `<link rel="stylesheet">` in `<head>` without `async`/`defer` or `media` attributes.
- **Why**: Render-blocking resources are the single biggest contributor to poor LCP per Google's own performance docs. **Source:** [web.dev — Eliminate render-blocking resources](https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources)

#### I4. Modern image formats (P2)
- **What**: Detect img/picture sources; flag if dominant format is JPEG/PNG instead of WebP/AVIF.
- **Why**: Google's image-SEO and Lighthouse "Serve images in next-gen formats" audit both recommend WebP/AVIF for materially smaller payloads at equivalent quality. **Sources:** [Google — Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images) · [web.dev — Serve images in modern formats](https://developer.chrome.com/docs/lighthouse/performance/uses-webp-images)

### J · Knowledge-graph signals

#### J1. Wikipedia / Wikidata mention check (P0)
- **What**: Query Wikipedia + Wikidata for the domain or brand name; report whether the entity is registered.
- **Why**: Independent third-party studies estimate Wikipedia material accounts for ~3% of GPT-3 training tokens and is one of the most frequently surfaced anchor sources across ChatGPT, Claude, and Gemini citations — particularly for factual/definitional queries. Wikidata, in turn, is the structured backbone Google's Knowledge Graph draws from. So Wikipedia/Wikidata presence is a *real* correlate of AI grounding, but the published evidence is observational, not from Tier-1 vendor docs. Recommendation: keep at P0 but downgrade tone from "strongest correlate" to "one strong, independently observable correlate." **Sources:** [Common Crawl — Wikipedia in Common Crawl](https://commoncrawl.org/) · [Semrush — Most-cited domains in AI (3-month study)](https://www.semrush.com/blog/most-cited-domains-ai/) · [Wikipedia in the Era of LLMs (arXiv 2503.02879)](https://arxiv.org/html/2503.02879v1)
- **Integration cost**: Wikipedia API (free, no key), Wikidata SPARQL (free, no key).

#### J2. sameAs link validation (P1)
- **What**: For Organization JSON-LD with sameAs, do a quick HEAD request to each URL and report broken links.
- **Why**: Broken `sameAs` URLs break the entity bridge Google uses to disambiguate a brand against the Knowledge Graph. **Source:** [Schema.org — sameAs](https://schema.org/sameAs)

#### J3. Common Crawl index check (P2)
- **What**: Use the Common Crawl URL Index API to confirm the domain is indexed.
- **Why**: The 2024 Mozilla Foundation report found ~64% of 47 surveyed LLMs released 2019-2023 used Common Crawl in their pre-training mix; Wikipedia-derived analyses put Common Crawl at >80% of GPT-3's training tokens. Presence in CC is a useful proxy for "your site was ingestible by the open-LLM ecosystem." **Sources:** [Common Crawl — CCBot](https://commoncrawl.org/ccbot) · [Mozilla Foundation 2024 — Training Data for the Price of a Sandwich (Common Crawl report)](https://assets.mofoprod.net/network/documents/Common_Crawl_Mozilla_Foundation_2024.pdf)
- **Integration cost**: Common Crawl Index API (free).

### K · E-E-A-T deep signals

#### K1. About-page depth (P1)
- **What**: If the sampler picks an `about` page, check word count, presence of named people, dates, contact info.
- **Why**: Google's helpful-content guidance and Search Quality Rater Guidelines repeatedly point at the About page as one of the primary places raters look for evidence of who runs the site, when it was established, and how to contact them — all classic E-E-A-T (Trust) inputs. **Sources:** [Google — Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) · [Google — Search Quality Rater Guidelines (PDF)](https://services.google.com/fh/files/misc/hsw-sqrg.pdf)

#### K2. NAP (Name, Address, Phone) detection (P1)
- **What**: Look for structured contact info (Organization JSON-LD with address/telephone, vCard, hCard, or visible patterns).
- **Why**: Visible, consistent NAP is a foundational local-SEO signal, and structured contact data on the Organization entity is what feeds Knowledge Graph contact panels. **Sources:** [Google — LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business) · [Schema.org — PostalAddress](https://schema.org/PostalAddress)

#### K3. Author bio / qualifications (P2)
- **What**: For article pages, check whether author has a linked bio page and that bio has E-E-A-T signals.
- **Why**: Google's helpful-content doc says: "bylines should lead to further information about the author or authors involved, giving background about them and the areas they write about." That's a direct, current statement; no separate AI-vendor doc on the same point, so the "AI source preference" framing should stay cautious. **Source:** [Google — Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

### L · Content-quality heuristics (the "cozmetic.ro problem")

#### L1. Boilerplate ratio (P0)
- **What**: Compare visible-text similarity across multiple pages on the same site; flag if pages are >70% identical.
- **Why**: Important nuance from the fact-check: Google explicitly says there is **no "duplicate content penalty"** in the classical sense (Mueller, 2017/2020/2024). What Google *does* act on is scaled thin/templated content under the "scaled content abuse" policy (March 2024 spam update). There is no published evidence that AI assistants directly penalise boilerplate — they just don't find anything worth quoting. Reframe the check as "thin/templated content" rather than "duplicate-content penalty." **Sources:** [Google — Spam policies for Google web search (Scaled content abuse)](https://developers.google.com/search/docs/essentials/spam-policies) · [Search Engine Journal — Mueller: No duplicate content penalty](https://www.searchenginejournal.com/duplicate-content-not-a-penalty/) · [Google — Helpful content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

#### L2. Reading-level scoring (P1)
- **What**: Compute Flesch Reading Ease on visible text.
- **Why**: Reading level is a usability signal, not a Google ranking signal — Google has explicitly said it does not use Flesch-Kincaid as a ranking factor. For AI assistants there's also no evidence of a reading-level preference. Keep this only as an *informational* metric, not a scored check. **⚠ no credible source found** confirming AI preference; recommend demoting from P1 to "advisory metric, no score impact."

#### L3. Salesy / boilerplate phrase detection (P2)
- **What**: Score density of patterns like "best in class", "world-leading", "synergy", boilerplate hero copy.
- **Why**: Distinguishes substantive content from filler. No Tier-1 source supports this as a discrete ranking or AI-citation signal; it overlaps with Google's broader "people-first content" framing but is heuristic. **⚠ no credible source found** — only ship behind a feature flag, mark as experimental.

### M · AI vendor specifics

#### M1. ChatGPT browsing test (P0)
- **What**: For paid tier: query the OpenAI API with a prompt asking about the user's site and capture whether/how it surfaces.
- **Why**: Direct evidence of citation behaviour, beats proxies. Costs ~$0.01-0.05 per scan. Out of scope for free tier.

#### M2. Perplexity citation test (P0)
- **What**: Same with Perplexity API.
- **Why**: Perplexity is the most transparent about citations.

#### M3. Google AI Mode test (P1)
- **What**: Same with Google AI Mode (if API is available; otherwise skip).
- **Why**: AI Overviews drive significant traffic; direct measurement is gold-standard.

### N · Anti-bot / WAF detection

#### N1. Crawl-time challenge detection (P1)
- **What**: When fetching, look for known CAPTCHA / challenge HTML patterns (Cloudflare, Akamai, DataDome, PerimeterX).
- **Why**: A WAF challenging unknown crawlers will also challenge AI bots, and our scanner currently reports `fetch.failed` without explaining why. Cloudflare publishes the `cf-mitigated: challenge` response header and `cf-chl-*` cookie markers; DataDome's challenges include the `x-datadome` response header and `datadome` Set-Cookie value. Akamai Bot Manager and HUMAN (PerimeterX) don't publish detection fingerprints publicly — third-party scraping-tool docs are the practical reference. **Sources:** [Cloudflare — Detect a Challenge Page response (cf-mitigated header)](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) · [DataDome bot signatures (third-party reference)](https://scrapfly.io/blog/posts/how-to-bypass-datadome-anti-scraping)

#### N2. Mobile bot vs desktop bot variance (P2)
- **What**: Optionally fetch with both a mobile and desktop UA; compare key signals.
- **Why**: Since 5 July 2024, Google indexes the mobile-rendered version of every site (mobile-first indexing complete), so the mobile DOM is what materially affects search. Sites that ship a stripped-down mobile experience are penalising themselves on the version Google actually indexes. **Sources:** [Google — Mobile-first Indexing Best Practices](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) · [Google Search Central Blog — Mobile-first is here (Oct 2023)](https://developers.google.com/search/blog/2023/10/mobile-first-is-here)

---

## Part 3 — Out of scope (intentionally parked)

- **Full-site crawl beyond 10 pages**: Worker free tier limits; sampler covers the diversity question better.
- **PDF / Word export**: Free tier doesn't justify the build. Share-link covers the use case.
- **Email-the-report**: Conflicts with the "no friction" positioning.
- **Multilingual UI**: English only at v1; Romanian planned post-launch.
- **User accounts & history**: Adds friction; the open share-link covers history sufficiently.
- **Competitor comparison**: Out of scope for the free tier.
- **Notion / Slack / Linear integrations**: Out of scope; lives in adjacent commercial tools.

---

## Sources

Tier 1 references (vendor / standards) used above:

1. [RFC 9309 — Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
2. [RFC 6797 — HTTP Strict Transport Security (HSTS)](https://www.rfc-editor.org/rfc/rfc6797)
3. [RFC 7932 — Brotli Compressed Data Format](https://www.rfc-editor.org/rfc/rfc7932)
4. [OpenAI — Overview of OpenAI Crawlers (GPTBot, ChatGPT-User, OAI-SearchBot)](https://platform.openai.com/docs/bots)
5. [Anthropic — Does Anthropic crawl data from the web?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
6. [Perplexity — Crawlers documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
7. [Google — Google crawlers / Google-Extended](https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)
8. [Apple — About Applebot (incl. Applebot-Extended)](https://support.apple.com/en-us/119829)
9. [Amazon — About Amazonbot](https://developer.amazon.com/amazonbot)
10. [Common Crawl — CCBot](https://commoncrawl.org/ccbot)
11. [Meta — facebookexternalhit & Meta web crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/)
12. [Google Search Central Blog — HTTPS as a ranking signal (Aug 2014)](https://developers.google.com/search/blog/2014/08/https-as-ranking-signal)
13. [Google — Secure your site with HTTPS](https://developers.google.com/search/docs/advanced/security/https)
14. [Google — Mobile-first Indexing Best Practices](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)
15. [Google Search Central Blog — Mobile-first is here (Oct 2023)](https://developers.google.com/search/blog/2023/10/mobile-first-is-here)
16. [Google — Understanding Core Web Vitals and Google search results](https://developers.google.com/search/docs/appearance/core-web-vitals)
17. [web.dev — Web Vitals](https://web.dev/articles/vitals)
18. [web.dev — Defining Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
19. [Google — Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
20. [Google — Product structured data (intro)](https://developers.google.com/search/docs/appearance/structured-data/product)
21. [Google — Merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)
22. [Google — Logo / Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/logo)
23. [Google — LocalBusiness structured data](https://developers.google.com/search/docs/appearance/structured-data/local-business)
24. [Google — Mark Up FAQs with Structured Data](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
25. [Google Search Central Blog — Changes to HowTo and FAQ rich results (Aug 2023)](https://developers.google.com/search/blog/2023/08/howto-faq-changes)
26. [Google — Intro to structured data markup](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
27. [Google — Robots meta tag, data-nosnippet, and X-Robots-Tag specifications](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
28. [Google — Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
29. [sitemaps.org protocol](https://www.sitemaps.org/protocol.html)
30. [Google — Consolidate duplicate URLs with canonicals](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
31. [Google — Keep a simple URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure)
32. [Google — Redirects and Google Search](https://developers.google.com/search/docs/crawling-indexing/301-redirects)
33. [Google — Crawl Budget Management For Large Sites](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget)
34. [Google — Influencing title links in search results](https://developers.google.com/search/docs/appearance/title-link)
35. [Google — Control your snippets in search](https://developers.google.com/search/docs/appearance/snippet)
36. [Google — Define a favicon to show in search results](https://developers.google.com/search/docs/appearance/favicon-in-search)
37. [Google — Image SEO best practices](https://developers.google.com/search/docs/appearance/google-images)
38. [Google — Featured snippets and your website](https://developers.google.com/search/docs/appearance/featured-snippets)
39. [Google — Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
40. [Google Search Central Blog — E-E-A-T (extra "E" for Experience, Dec 2022)](https://developers.google.com/search/blog/2022/12/google-raters-guidelines-e-e-a-t)
41. [Google — Search Quality Rater Guidelines (PDF)](https://services.google.com/fh/files/misc/hsw-sqrg.pdf)
42. [Google — Spam policies for Google web search (incl. scaled content abuse)](https://developers.google.com/search/docs/essentials/spam-policies)
43. [Schema.org — Article](https://schema.org/Article)
44. [Schema.org — Organization](https://schema.org/Organization)
45. [Schema.org — sameAs](https://schema.org/sameAs)
46. [Schema.org — datePublished](https://schema.org/datePublished)
47. [Schema.org — PostalAddress](https://schema.org/PostalAddress)
48. [W3C / WCAG 2.1 — Non-text Content (1.1.1)](https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html)
49. [W3C / WCAG 2.1 — Language of Page (3.1.1)](https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html)
50. [W3C / WCAG 2.1 — Headings and Labels (2.4.6)](https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels.html)
51. [HTML Living Standard — `<title>` element](https://html.spec.whatwg.org/multipage/semantics.html#the-title-element)
52. [HTML Living Standard — `<article>` element](https://html.spec.whatwg.org/multipage/sections.html#the-article-element)
53. [MDN — `<main>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/main)
54. [MDN — `lang` global attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/lang)
55. [MDN — Heading elements](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/Heading_Elements)
56. [Open Graph protocol — ogp.me](https://ogp.me/)
57. [X (Twitter) — Cards markup reference](https://developer.x.com/en/docs/twitter-for-websites/cards/overview/markup)
58. [Apple — Configuring Web Applications (apple-touch-icon)](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
59. [llmstxt.org — llms.txt proposal](https://llmstxt.org/)
60. [Cloudflare — Detect a Challenge Page response](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)
61. [HTTP Archive Web Almanac 2024 — Page Weight](https://almanac.httparchive.org/en/2024/page-weight)
62. [web.dev — Enable text compression](https://developer.chrome.com/docs/lighthouse/performance/uses-text-compression)
63. [web.dev — Eliminate render-blocking resources](https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources)
64. [web.dev — Serve images in modern formats](https://developer.chrome.com/docs/lighthouse/performance/uses-webp-images)

Tier 2 / 3 references (industry analysis, third-party studies):

65. [Search Engine Land — Multiple H1s won't hurt your SEO, Google says (Mueller)](https://searchengineland.com/multiple-h1s-wont-get-in-the-way-of-your-seo-google-says-322909)
66. [Search Engine Journal — Mueller on <5 hops in a redirect chain](https://www.searchenginejournal.com/googles-john-mueller-recommends-less-than-5-hops-per-redirect-chain/344664/)
67. [Search Engine Journal — Google Drops FAQ Rich Results (May 2026)](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/)
68. [Search Engine Journal — Mueller: No duplicate content penalty](https://www.searchenginejournal.com/duplicate-content-not-a-penalty/)
69. [Search Engine Land — Meet llms.txt, a proposed standard](https://searchengineland.com/llms-txt-proposed-standard-453676)
70. [Search Engine Land — Schema markup and AI search, no hype](https://searchengineland.com/schema-markup-ai-search-no-hype-472339)
71. [Search Engine Land — AI Search and JavaScript Rendering case study](https://www.gsqi.com/marketing-blog/ai-search-javascript-rendering/)
72. [Semrush — Most-cited domains in AI (3-month study)](https://www.semrush.com/blog/most-cited-domains-ai/)
73. [arXiv — Wikipedia in the Era of LLMs: Evolution and Risks (2503.02879)](https://arxiv.org/html/2503.02879v1)
74. [Mozilla Foundation 2024 — Training Data for the Price of a Sandwich (Common Crawl)](https://assets.mofoprod.net/network/documents/Common_Crawl_Mozilla_Foundation_2024.pdf)
75. [DataDome — Bytespider behaviour](https://datadome.co/bots/bytespider/)
76. [DataDome — cohere-ai behaviour](https://datadome.co/bots/cohere-ai/)
77. [Am I Cited — NoAI meta tags](https://www.amicited.com/blog/noai-meta-tags-controlling-ai-access/)
78. [Am I Cited — Tables and lists in AI visibility](https://www.amicited.com/blog/tables-lists-structured-data-ai-visibility/)
79. [Scrapfly — DataDome bypass / fingerprints (used only as a third-party reference for challenge-page signatures)](https://scrapfly.io/blog/posts/how-to-bypass-datadome-anti-scraping)

---

## Verification log

One bullet per check. "Verified" = at least one Tier-1 source found. "Verified (Tier 2/3)" = no Tier-1 source exists; best available is industry analysis. "Refuted / reframe" = the underlying premise needed correction. "No credible source" = keep, but de-emphasise.

### Part 1 — Active checks

- **A1 (robots.txt fetched)** — **Verified** via [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html). Missing robots.txt does default to "allow all" under the standard. No change needed.
- **A2 (14 AI bot disallow rules)** — **Verified, with corrections**. Bot list needs cleanup:
  - `anthropic-ai` is **deprecated** (replaced by `ClaudeBot`; we should also list `Claude-User` and `Claude-SearchBot`).
  - `Claude-Web` is **deprecated** (not in our list anyway, good).
  - `FacebookBot` is technically valid but obscure (speech-recognition data); the bot the public actually thinks of as "Facebook's crawler" is `facebookexternalhit` (link previews). For AI training the right UA is **`Meta-ExternalAgent`**, which we already have.
  - `Bytespider` and `cohere-ai` are widely reported to **not honour robots.txt** — flagging is still useful, but message should warn the directive may be ignored.
  - **Recommendation**: replace `anthropic-ai` with `ClaudeBot, Claude-User, Claude-SearchBot`; add `Perplexity-User` (new bot, separate UA from PerplexityBot); consider dropping `FacebookBot` or labelling it as "speech-recognition only".
- **A3 (X-Robots-Tag, noai/noimageai)** — **Refuted / reframe**. `noai`/`noimageai` are *not* a W3C or IETF standard and there is no Tier-1 statement from OpenAI, Anthropic, Google or Perplexity formally committing to honour them. Keep the check but lower the severity of `noai`/`noimageai` flags from blocking to warn, and explain the limitation in the message.
- **A4 (Meta robots noindex on home)** — **Verified** via [Google's robots meta tag spec](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).
- **B1 (Sitemap reachable)** — **Verified** via [Google sitemaps docs](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) and [sitemaps.org](https://www.sitemaps.org/protocol.html). AI-bot sitemap consumption is observational, not vendor-documented; soften that part of the message.
- **B2 (llms.txt presence)** — **Verified (Tier 2)**. Standard exists at llmstxt.org; **no major LLM vendor confirms consumption**; Google has publicly rejected it. Keep at `nice/warn` only — do not promote.
- **B3 (Canonical tag)** — **Verified** via [Google canonicals docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
- **B4 (lang attribute)** — **Verified** via WCAG 3.1.1.
- **B5 (HTTPS + HSTS)** — **Verified** via [Google's 2014 HTTPS announcement](https://developers.google.com/search/blog/2014/08/https-as-ranking-signal) and RFC 6797.
- **B6 (Redirect chain length)** — **Verified** via [Google redirects docs](https://developers.google.com/search/docs/crawling-indexing/301-redirects) and Mueller's <5-hop guidance.
- **C1 (Any structured data present)** — **Verified** via [Google structured data intro](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data). AI-citation correlation is Tier-2 only.
- **C2 (Article completeness)** — **Verified** via [Google's Article docs](https://developers.google.com/search/docs/appearance/structured-data/article). Note Google's doc says no property is strictly "required" — but the four we check (headline/author/datePublished + image) are the recommended set.
- **C3 (Organization completeness)** — **Verified** via [Google Logo/Organization docs](https://developers.google.com/search/docs/appearance/structured-data/logo) and [Schema.org sameAs](https://schema.org/sameAs).
- **C4 (Product completeness)** — **Verified** via [Google Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product).
- **C5 (FAQPage minimum)** — **Refuted / reframe**. Google **deprecated FAQ rich results in May 2026** — the SEO/SERP value is gone, although schema is still useful for AI citation. Message needs rewriting; consider demoting severity.
- **C6 (OG + Twitter Card)** — **Verified** via [ogp.me](https://ogp.me/) and [Meta's facebookexternalhit docs](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/). AI-card reuse is observational.
- **D1 (Raw-HTML word count)** — **Verified** via [OpenAI bots docs](https://platform.openai.com/docs/bots) and [Anthropic's crawler doc](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) — they do not execute JS.
- **D2 (H1 count)** — **Partially refuted**. Google has explicitly said multiple H1s do not hurt SEO. Recommendation: keep `no-H1` as `important/warn`, but downgrade the `multiple-H1` flag to `nice/warn` and reword the message so it doesn't claim SEO penalty.
- **D3 (Heading hierarchy)** — **Verified** via [WCAG 2.4.6](https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels.html).
- **D4 (Semantic landmarks)** — **Verified** via [HTML Living Standard](https://html.spec.whatwg.org/multipage/sections.html#the-article-element) and MDN.
- **D5 (Image alt coverage)** — **Verified** via [WCAG 1.1.1](https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html) and [Google image SEO docs](https://developers.google.com/search/docs/appearance/google-images).
- **D6 (Text-to-code ratio)** — **No credible source**. Heuristic only; keep low severity, do not market as a primary signal.
- **E1 (Author byline)** — **Verified** via [Google helpful-content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) and E-E-A-T blog post.
- **E2 (Publish / update date)** — **Verified** via [Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article).
- **E3 (Authoritative outbound links)** — **Partially verified**. Google's helpful-content guidance supports "clear sourcing", but the specific claim that AI assistants directly *weight* outbound-link authority has no Tier-1 source. Keep, but reframe.
- **E4 (Internal link density on home)** — **Verified** via [Google crawl budget docs](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget).
- **F1 (Question-form headings)** — **Verified (Tier 2 only)**. No Tier-1 vendor doc; supported by featured-snippets behaviour and third-party AI-citation analyses.
- **F2 (Lists or tables present)** — **Verified (Tier 2 mostly)**. [Google featured snippets docs](https://developers.google.com/search/docs/appearance/featured-snippets) cover lists/tables for snippet extraction; AI-Overview-specific data is third-party.
- **F3 (FAQ schema match)** — **Reframe** (see C5). Drop SERP framing; keep as AI-citation-shape check.
- **G1 (Title length)** — **Verified** via [Google title links docs](https://developers.google.com/search/docs/appearance/title-link). The 30-65 char window is industry convention, not Google-published.
- **G2 (Meta description)** — **Verified** via [Google snippets docs](https://developers.google.com/search/docs/appearance/snippet). "AI assistants quote meta description" is observational, not Tier-1.
- **G3 (Favicon + apple-touch-icon)** — **Verified** via [Google favicon docs](https://developers.google.com/search/docs/appearance/favicon-in-search) and [Apple WebContent docs](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).
- **G4 (Mobile viewport)** — **Verified** via [Google mobile-first indexing docs](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) — rollout completed 5 July 2024.
- **G5 (Core Web Vitals)** — **Verified** via [web.dev/vitals](https://web.dev/articles/vitals) and [Google CWV docs](https://developers.google.com/search/docs/appearance/core-web-vitals). Thresholds: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile.
- **H1 (URL hygiene on home)** — **Verified** via [Google URL structure docs](https://developers.google.com/search/docs/crawling-indexing/url-structure).
- **H2 (Suggest next-most-missing schema)** — **Verified** via [Google Logo/Organization docs](https://developers.google.com/search/docs/appearance/structured-data/logo).
- **H3 (Deep links for citation testing)** — **N/A** (feature, not a check).

### Part 2 — Proposed additions

- **I1 (Page weight)** — **Partially refuted on threshold**. Median 2024 page is 2.3-2.7 MB; the rubric's 1.5 MB target would warn on the majority of the web. Recommendation: raise threshold to ~3 MB and split the check into "blocking JS bytes" vs "image bytes".
- **I2 (Compression)** — **Verified** via [Lighthouse text-compression audit](https://developer.chrome.com/docs/lighthouse/performance/uses-text-compression).
- **I3 (Render-blocking resources)** — **Verified** via [Lighthouse render-blocking audit](https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources).
- **I4 (Modern image formats)** — **Verified** via [Lighthouse modern-formats audit](https://developer.chrome.com/docs/lighthouse/performance/uses-webp-images) and [Google image SEO docs](https://developers.google.com/search/docs/appearance/google-images).
- **J1 (Wikipedia / Wikidata)** — **Verified (Tier 2)**. Wikipedia *is* a major and observable correlate of LLM grounding, but the "strongest correlate" phrasing was overclaiming. Promote to P0, but soften the language. The mozilla report on Common Crawl + the Wikipedia-in-LLMs arXiv paper are the strongest defensible references.
- **J2 (sameAs link validation)** — **Verified** via [Schema.org sameAs](https://schema.org/sameAs); strong fit for our scope.
- **J3 (Common Crawl index)** — **Verified** via [Mozilla 2024 report](https://assets.mofoprod.net/network/documents/Common_Crawl_Mozilla_Foundation_2024.pdf). Strong rationale; cheap integration. Recommend promoting from P2 → P1.
- **K1 (About-page depth)** — **Verified** via [Google helpful-content docs](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) and [SQRG](https://services.google.com/fh/files/misc/hsw-sqrg.pdf).
- **K2 (NAP detection)** — **Verified** via [Google LocalBusiness docs](https://developers.google.com/search/docs/appearance/structured-data/local-business).
- **K3 (Author bio / qualifications)** — **Verified** via [Google helpful-content docs](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
- **L1 (Boilerplate ratio)** — **Reframe**. Mueller has repeatedly said there is no "duplicate content penalty"; what Google does penalise is scaled thin/templated content (March 2024 spam policy). Reword from "duplicate-content penalty" to "scaled-content / thin-content risk".
- **L2 (Reading-level scoring)** — **No credible source** for AI preference. Demote: keep as an informational metric, do not include in score.
- **L3 (Salesy phrase detection)** — **No credible source**. Recommendation: keep behind a feature flag, label experimental.
- **M1 / M2 / M3 (vendor citation tests)** — Out of fact-check scope (architectural feature decisions, not claims).
- **N1 (Crawl-time challenge detection)** — **Verified** via [Cloudflare challenge-detection docs](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/). Akamai and PerimeterX have no Tier-1 published fingerprint list; rely on community-documented headers/cookies.
- **N2 (Mobile bot vs desktop bot variance)** — **Verified** via [Google mobile-first indexing docs](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing).
