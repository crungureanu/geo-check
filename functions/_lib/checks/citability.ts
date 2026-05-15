import type { CheckContext, Finding } from "../types";

export function citabilityChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  // Author byline
  if (page.bylineCandidates.length === 0) {
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

  // Dates
  if (page.dateCandidates.length === 0) {
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

  // Outbound authoritative links
  if (page.authoritativeOutboundCount === 0 && page.wordCount > 300) {
    findings.push({
      id: `cite.no-authoritative-outbound:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "No outbound links to authoritative sources",
      message:
        `${page.url} doesn't link out to recognised reference sites (.gov, .edu, Wikipedia, etc.). Citing real sources strengthens your own E-E-A-T signal and AI assistants weight cited content higher.`,
    });
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
