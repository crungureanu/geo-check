import type { CheckContext, Finding } from "../types";
import { sig } from "./_signal";
import { isSectionIndex } from "../page-selector";

// Outbound citation is a signal for pages that *make claims*: articles, FAQs,
// long-form guides. Landing pages, services, products, contact, pricing pages
// don't need outbound citations; forcing them produces gamed copy.
const CLAIMS_PAGE_TYPES = new Set(["article", "faq", "other"]);

// Parse a date candidate to epoch ms. dd/mm/yyyy is read UK-first (day
// first): Date.parse treats slashes as US M/D/Y, returning NaN for days
// > 12 (a visible UK "Last updated 14/06/2026" would be silently dropped)
// or the wrong month for ambiguous dates. ISO and textual-month forms
// ("14 June 2026", "May 2026") parse unambiguously, so pass them through.
function parseCandidateDate(s: string): number {
  const uk = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) {
    const d = +uk[1], m = +uk[2], y = +uk[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return Date.UTC(y, m - 1, d);
    return NaN;
  }
  return Date.parse(s);
}

export function citabilityChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;
  const u = page.finalUrl;

  // Author and date signals are meaningful for articles only. Other page
  // types do not carry a byline/date, so these signals are NOT APPLICABLE
  // there (emit nothing). Section-index pages (/blog, /news) are listings,
  // not articles: skip them too.
  const isIndexPage = isSectionIndex(page.url) || isSectionIndex(page.finalUrl);
  const expectsAuthorshipSignals = ctx.pageInfo.type === "article" && !isIndexPage;

  if (expectsAuthorshipSignals) {
    findings.push(
      page.bylineCandidates.length === 0
        ? sig("cite.author", {
            status: "warn",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0,
            pageUrl: u,
            title: "No author attribution detected",
            message: `${page.url} has no machine-readable author. If a name is shown visually but only as unmarked text (or rendered from a client-side payload), AI assistants cannot reliably attribute it. Make authorship explicit with one of: <meta name="author">, a JSON-LD author field, rel="author", or itemprop="author".`,
            fixSnippet: `<meta name="author" content="Author Name" />\n\n// or in JSON-LD:\n"author": { "@type": "Person", "name": "Author Name" }`,
          })
        : sig("cite.author", {
            status: "pass",
            severity: "important",
            discipline: "ai-seo",
            attainment: 1,
            pageUrl: u,
            title: "Author attribution present",
            message: `${page.url} exposes a machine-readable author.`,
          }),
    );

    findings.push(
      page.dateCandidates.length === 0
        ? sig("cite.date", {
            status: "warn",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0,
            pageUrl: u,
            title: "No publish or update date detected",
            message: `${page.url} has no detectable publication or modification date. Recency is a citation signal for AI assistants. Add a JSON-LD datePublished/dateModified or a <time datetime="..."> element.`,
            fixSnippet: `<time datetime="2026-05-15">Published 15 May 2026</time>\n\n// or in JSON-LD:\n"datePublished": "2026-05-15", "dateModified": "2026-05-15"`,
          })
        : sig("cite.date", {
            status: "pass",
            severity: "important",
            discipline: "ai-seo",
            attainment: 1,
            pageUrl: u,
            title: "Publish / update date present",
            message: `${page.url} exposes a detectable date.`,
          }),
    );

    // Recency (Wave 2a): cite.date asks "is there a date"; this asks "is it
    // recent". Only applicable when a parseable date exists (otherwise
    // cite.date already warns). Bands the freshest known date by age.
    const stamps = page.dateCandidates
      .map((d) => parseCandidateDate(d))
      .filter((n) => Number.isFinite(n) && n <= ctx.now + 86_400_000);
    if (stamps.length > 0) {
      const newest = Math.max(...stamps);
      const ageDays = (ctx.now - newest) / 86_400_000;
      const ageLabel =
        ageDays < 365
          ? `${Math.max(1, Math.round(ageDays / 30))} month(s)`
          : `${(ageDays / 365).toFixed(1)} years`;
      if (ageDays <= 365) {
        findings.push(
          sig("cite.recency", {
            status: "pass",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 1,
            pageUrl: u,
            title: "Content is recently dated",
            message: `${page.url}'s newest date is about ${ageLabel} old. Recent dates make AI assistants more likely to cite the page as current.`,
          }),
        );
      } else if (ageDays <= 730) {
        findings.push(
          sig("cite.recency", {
            status: "partial",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 0.5,
            pageUrl: u,
            title: "Content date is aging",
            message: `${page.url}'s newest date is about ${ageLabel} old. If the content is still accurate, refresh and re-date it so assistants do not discount it as outdated.`,
          }),
        );
      } else {
        findings.push(
          sig("cite.recency", {
            status: "warn",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 0,
            pageUrl: u,
            title: "Content date is stale",
            message: `${page.url}'s newest date is about ${ageLabel} old. A date this old signals neglect; review the content and update the published/modified date if it is still valid.`,
          }),
        );
      }
    }
  }

  // Outbound authoritative links: only APPLIES on claim-making pages with
  // enough content. Section-index pages excluded (indexes don't cite).
  const makesClaims = CLAIMS_PAGE_TYPES.has(ctx.pageInfo.type) && !isIndexPage;
  if (makesClaims && page.wordCount > 300) {
    const outboundCount = page.outboundDomains.length;
    if (page.authoritativeOutboundCount > 0) {
      findings.push(
        sig("cite.outbound", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Sources its claims",
          message: `${page.url} links out to recognised authoritative sources.`,
        }),
      );
    } else if (outboundCount > 0) {
      findings.push(
        sig("cite.outbound", {
          status: "partial",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0.6,
          pageUrl: u,
          title: "Outbound links present, authority not verified",
          message: `${page.url} links out to ${outboundCount} external ${outboundCount === 1 ? "domain" : "domains"}, but none are on our recognised high-authority list (which is deliberately partial). Sanity-check that the sources you cite are credible.`,
        }),
      );
    } else {
      findings.push(
        sig("cite.outbound", {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "No outbound links to authoritative sources",
          message: `${page.url} makes substantive claims but has no outbound links at all. Where you cite statistics, research, or technical assertions, link to the source (.gov, .edu, schema.org, Wikipedia, recognised industry publications). AI assistants weight content that grounds its claims.`,
        }),
      );
    }
  }

  // Internal links: only on home (orphaned-site signal).
  if (ctx.isHome) {
    findings.push(
      page.internalLinkCount < 5
        ? sig("cite.internal-links", {
            status: "warn",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 0,
            title: "Very few internal links on the home page",
            message: `The home page has only ${page.internalLinkCount} internal links. Add more navigation paths so crawlers can discover the rest of the site.`,
          })
        : sig("cite.internal-links", {
            status: "pass",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 1,
            title: "Internal linking is healthy",
            message: `The home page has ${page.internalLinkCount} internal links.`,
          }),
    );
  }

  return findings;
}
