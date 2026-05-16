import type { CheckContext, Finding } from "../types";
import { isSectionIndex } from "../page-selector";

function hasFaqSchema(page: { jsonLd: any[] }): boolean {
  return page.jsonLd.some((n: any) => {
    if (!n || typeof n !== "object") return false;
    const t = n["@type"];
    if (typeof t === "string") return t === "FAQPage";
    if (Array.isArray(t)) return t.includes("FAQPage");
    return false;
  });
}

// Question-form headings and FAQ schema are signals for informational content
// (articles, FAQs, long-form guides). On commercial / navigational pages they
// are inappropriate and would force unnatural copy ("How does AI consulting work?"
// is a worse h2 than "AI Consulting" on a services page).
const INFORMATIONAL_PAGE_TYPES = new Set(["article", "faq", "other"]);

export function answerShapeChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;
  const pageType = ctx.pageInfo.type;

  // Transactional/auth (B13) and boilerplate legal/policy (B14) pages are
  // not citation targets: no answer-shape expectations apply.
  if (pageType === "transactional" || pageType === "boilerplate") return findings;

  const longEnough = page.wordCount > 300;
  if (!longEnough) return findings;

  // Section-root URLs (/blog, /news, /case-studies) are listing pages: any
  // question-shaped headings on them are post titles, not Q&A pairs.
  const isListing = isSectionIndex(page.url) || isSectionIndex(page.finalUrl);
  const isInformational = INFORMATIONAL_PAGE_TYPES.has(pageType) && !isListing;

  // Hard news is poorly served by "rephrase your h2s as questions"; suppress
  // when the page declares NewsArticle (M4).
  const isNews = page.jsonLd.some((n: any) => {
    if (!n || typeof n !== "object") return false;
    const t = n["@type"];
    return t === "NewsArticle" || (Array.isArray(t) && t.includes("NewsArticle"));
  });

  // Question-form headings — only suggest on informational pages
  if (isInformational && !isNews && page.qaHeadings === 0) {
    findings.push({
      id: `answer.no-question-headings:${page.finalUrl}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "No question-shaped headings",
      message:
        `${page.url} has no headings phrased as questions ("How does…", "Why is…"). AI assistants extract Q&A pairs from such headings. Rephrase 1-2 h2/h3 headings as questions when appropriate.`,
    });
  }

  // Lists / tables
  if (page.listCount === 0 && page.tableCount === 0) {
    findings.push({
      id: `answer.no-lists:${page.finalUrl}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "No lists or tables on the page",
      message:
        `${page.url} contains no <ul>, <ol>, or <table>. Lists and tables are the most cited structures in AI answers. Convert dense paragraphs into bullet lists where appropriate.`,
    });
  }

  // FAQ pattern: a genuine FAQ section (3+ headings that actually read as
  // questions — end with "?", not CTAs) with no FAQPage JSON-LD. This is NOT
  // gated by page type: a real FAQ block at the end of a services, product,
  // or article page is legitimate and should be credited. It is gated on the
  // strict faqHeadings count so prose with interrogative-worded section titles
  // ("How AI Agents Help Small Business") never triggers it. Listings excluded
  // (their "questions" are post titles in a card grid).
  if (!isListing && page.faqHeadings >= 3 && !hasFaqSchema(page)) {
    findings.push({
      id: `answer.no-faq-schema:${page.finalUrl}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "Q&A content not marked up as FAQ schema",
      message:
        `${page.url} has ${page.faqHeadings} headings written as questions but no FAQPage JSON-LD. Google stopped showing FAQ rich results in 2023, so this no longer helps SERP appearance, but AI assistants still use the structured Q&A pairs when extracting answers. Optional but cheap, and only worth doing if these really are question/answer pairs.`,
      fixSnippet: `<script type="application/ld+json">\n${JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            { "@type": "Question", name: "Your question?", acceptedAnswer: { "@type": "Answer", text: "Short, direct answer." } },
          ],
        },
        null,
        2,
      )}\n</script>`,
    });
  }

  return findings;
}
