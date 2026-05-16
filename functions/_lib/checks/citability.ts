import type { CheckContext, Finding } from "../types";
import { isSectionIndex } from "../page-selector";

// Outbound citation is a signal for pages that *make claims*: articles, FAQs,
// long-form guides. Landing pages, services, products, contact, pricing pages
// don't need outbound citations; forcing them produces gamed copy.
const CLAIMS_PAGE_TYPES = new Set(["article", "faq", "other"]);

export function citabilityChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  // Author and date signals are meaningful for articles. Home/about/contact/pricing/
  // service/product pages don't typically carry an author byline or publish date,
  // and penalising them produces false positives. Section-index pages (/blog,
  // /news, /case-studies) classify as "article" by URL but are listings of
  // articles, not articles themselves; skip them too.
  const isIndexPage = isSectionIndex(page.url) || isSectionIndex(page.finalUrl);
  const expectsAuthorshipSignals = ctx.pageInfo.type === "article" && !isIndexPage;

  if (expectsAuthorshipSignals && page.bylineCandidates.length === 0) {
    findings.push({
      id: `cite.no-author:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "ai-seo",
      title: "No author attribution detected",
      message:
        `${page.url} has no detectable author. AI assistants prefer to cite content with clear authorship. Add one of: <meta name="author">, JSON-LD author field, or a visible "By [Name]" byline.`,
      fixSnippet: `<meta name="author" content="Author Name" />\n\n// or in JSON-LD:\n"author": { "@type": "Person", "name": "Author Name" }`,
    });
  }

  if (expectsAuthorshipSignals && page.dateCandidates.length === 0) {
    findings.push({
      id: `cite.no-date:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "ai-seo",
      title: "No publish or update date detected",
      message:
        `${page.url} has no detectable publication or modification date. Recency is a citation signal for AI assistants. Add a JSON-LD datePublished/dateModified or a <time datetime="..."> element.`,
      fixSnippet: `<time datetime="2026-05-15">Published 15 May 2026</time>\n\n// or in JSON-LD:\n"datePublished": "2026-05-15", "dateModified": "2026-05-15"`,
    });
  }

  // Outbound authoritative links — only relevant on pages that make claims.
  // Section-index pages (/blog, /case-studies) are excluded too: indexes
  // legitimately don't cite, the articles they link to do.
  const makesClaims = CLAIMS_PAGE_TYPES.has(ctx.pageInfo.type) && !isIndexPage;
  if (makesClaims && page.wordCount > 300) {
    const outboundCount = page.outboundDomains.length;
    if (page.authoritativeOutboundCount > 0) {
      // sourced — no finding
    } else if (outboundCount > 0) {
      // links-present-unverified: don't penalise, just surface it as a pass note.
      findings.push({
        id: `cite.outbound-unverified:${page.url}`,
        status: "pass",
        severity: "nice",
        discipline: "ai-seo",
        title: "Outbound links present, authority not verified",
        message:
          `${page.url} links out to ${outboundCount} external ${outboundCount === 1 ? "domain" : "domains"}, but none are on our recognised high-authority list (which is deliberately partial). Not penalised. Just sanity-check that the sources you cite are credible.`,
      });
    } else {
      // unsourced: a claim-heavy page with no outbound links at all.
      findings.push({
        id: `cite.no-authoritative-outbound:${page.url}`,
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        title: "No outbound links to authoritative sources",
        message:
          `${page.url} makes substantive claims but has no outbound links at all. Where you cite statistics, research, or technical assertions, link to the source (.gov, .edu, schema.org, Wikipedia, recognised industry publications). AI assistants weight content that grounds its claims.`,
      });
    }
  }

  // Internal links — only flag on home, indicates orphaned site
  if (ctx.isHome && page.internalLinkCount < 5) {
    findings.push({
      id: "cite.thin-internal-links",
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: "Very few internal links on the home page",
      message:
        `The home page has only ${page.internalLinkCount} internal links. Add more navigation paths so crawlers can discover the rest of the site.`,
    });
  }

  return findings;
}
