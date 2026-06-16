import type { CheckContext, Finding } from "../types";
import { sig, note } from "./_signal";
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
// are inappropriate and would force unnatural copy.
const INFORMATIONAL_PAGE_TYPES = new Set(["article", "faq", "other"]);

export function answerShapeChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;
  const u = page.finalUrl;
  const pageType = ctx.pageInfo.type;

  // Transactional/auth (B13) and boilerplate legal/policy (B14) pages: no
  // answer-shape expectations apply (everything here NOT APPLICABLE).
  if (pageType === "transactional" || pageType === "boilerplate") return findings;

  const longEnough = page.wordCount > 300;
  if (!longEnough) return findings; // short pages: answer-shape not applicable

  const isListing = isSectionIndex(page.url) || isSectionIndex(page.finalUrl);
  const isInformational = INFORMATIONAL_PAGE_TYPES.has(pageType) && !isListing;

  const isNews = page.jsonLd.some((n: any) => {
    if (!n || typeof n !== "object") return false;
    const t = n["@type"];
    return t === "NewsArticle" || (Array.isArray(t) && t.includes("NewsArticle"));
  });

  // Question-form headings: only APPLIES on informational, non-news pages.
  if (isInformational && !isNews) {
    findings.push(
      page.qaHeadings === 0
        ? sig("answer.question-headings", {
            status: "warn",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 0,
            pageUrl: u,
            title: "No question-shaped headings",
            message: `${page.url} has no headings phrased as questions ("How does...", "Why is..."). AI assistants extract Q&A pairs from such headings. Rephrase 1-2 h2/h3 headings as questions when appropriate.`,
          })
        : sig("answer.question-headings", {
            status: "pass",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 1,
            pageUrl: u,
            title: "Has question-shaped headings",
            message: `${page.url} uses question-form headings AI assistants can extract.`,
          }),
    );
  }

  // Lists / tables: applies to any long page.
  findings.push(
    page.listCount === 0 && page.tableCount === 0
      ? sig("answer.lists", {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "No lists or tables on the page",
          message: `${page.url} contains no <ul>, <ol>, or <table>. Lists and tables are the most cited structures in AI answers. Convert dense paragraphs into bullet lists where appropriate.`,
        })
      : sig("answer.lists", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Has lists or tables",
          message: `${page.url} uses lists/tables, which AI answers cite often.`,
        }),
  );

  // FAQ schema: only APPLIES when a genuine FAQ block (3+ question headings)
  // exists. No Q&A content => not a miss, just not applicable (emit nothing).
  if (!isListing && page.faqHeadings >= 3) {
    findings.push(
      !hasFaqSchema(page)
        ? sig("answer.faq-schema", {
            status: "warn",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 0,
            pageUrl: u,
            title: "Q&A content not marked up as FAQ schema",
            message: `${page.url} has ${page.faqHeadings} headings written as questions but no FAQPage JSON-LD. Google stopped showing FAQ rich results in 2023, so this no longer helps SERP appearance, but AI assistants still use the structured Q&A pairs when extracting answers. Optional but cheap, and only worth doing if these really are question/answer pairs.`,
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
          })
        : sig("answer.faq-schema", {
            status: "pass",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 1,
            pageUrl: u,
            title: "Q&A marked up as FAQ schema",
            message: `${page.url} backs its Q&A content with FAQPage JSON-LD.`,
          }),
    );
  }

  // Ambiguous question-like headings: they open with an interrogative word
  // ("How...", "Who...", "What...") but are not written as questions (no "?"),
  // and have little text beneath. We cannot tell a real Q&A heading from a
  // declarative section title, so the bar-3 citable-passage signal never SCORES
  // them. Surface the thin ones here as an UNSCORED suggestion (weight 0) so the
  // user can act if any are genuinely meant as questions. Not on listing pages.
  if (!isListing) {
    const ambiguous = page.sections.filter((s) => s.maybeQuestion && s.words < 80);
    if (ambiguous.length > 0) {
      const n = ambiguous.length;
      findings.push(
        note(`answer.maybe-qa:${u}`, {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          title: "Headings that may be questions (not scored)",
          message: `${page.url} has ${n} heading${n === 1 ? "" : "s"} that read${n === 1 ? "s" : ""} like ${n === 1 ? "a question" : "questions"} ("How...", "What...", "Why...") but ${n === 1 ? "is" : "are"} not written as ${n === 1 ? "a question" : "questions"} (no "?"), with little text beneath. We could not confirm ${n === 1 ? "it is" : "they are"} genuine Q&A, so we did not score ${n === 1 ? "it" : "them"}. If ${n === 1 ? "it is" : "any are"} a question your audience actually asks, phrase the heading as a question and add a self-contained 115-180 word answer directly beneath it, so AI assistants can quote it without surrounding context.`,
        }),
      );
    }
  }

  return findings;
}
