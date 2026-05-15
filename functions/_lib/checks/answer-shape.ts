import type { CheckContext, Finding } from "../types";

function hasFaqSchema(page: { jsonLd: any[] }): boolean {
  return page.jsonLd.some((n: any) => {
    if (!n || typeof n !== "object") return false;
    const t = n["@type"];
    if (typeof t === "string") return t === "FAQPage";
    if (Array.isArray(t)) return t.includes("FAQPage");
    return false;
  });
}

export function answerShapeChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  const longEnough = page.wordCount > 300;
  if (!longEnough) return findings;

  // Question-form headings
  if (page.qaHeadings === 0) {
    findings.push({
      id: `answer.no-question-headings:${page.url}`,
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
      id: `answer.no-lists:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "No lists or tables on the page",
      message:
        `${page.url} contains no <ul>, <ol>, or <table>. Lists and tables are the most cited structures in AI answers. Convert dense paragraphs into bullet lists where appropriate.`,
    });
  }

  // FAQ pattern: question headings present but no FAQ schema
  if (page.qaHeadings >= 3 && !hasFaqSchema(page)) {
    findings.push({
      id: `answer.no-faq-schema:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "ai-seo",
      title: "Q&A content not marked up as FAQ schema",
      message:
        `${page.url} has ${page.qaHeadings} question-shaped headings but no FAQPage JSON-LD. Wrap the Q&A pairs in FAQ schema so AI assistants can pull them directly.`,
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
