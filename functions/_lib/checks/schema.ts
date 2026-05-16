import type { CheckContext, Finding } from "../types";

function typesOf(node: any): string[] {
  if (!node || typeof node !== "object") return [];
  const t = node["@type"];
  if (Array.isArray(t)) return t.map((x) => String(x));
  if (typeof t === "string") return [t];
  return [];
}

export function schemaChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  // Transactional / auth pages are not citation targets, so "no structured
  // data here" is not a meaningful gap. Suppress schema.none for them; still
  // validate any schema they do ship below. (B13)
  const isTransactional = ctx.pageInfo.type === "transactional";

  if (!isTransactional && page.jsonLdRawCount === 0 && !page.hasMicrodata && !page.hasRdfa) {
    findings.push({
      id: "schema.none",
      status: "warn",
      severity: "important",
      discipline: "ai-seo",
      title: "No structured data on this page",
      message:
        `${page.url} has no JSON-LD, microdata, or RDFa. Structured data is how AI assistants reliably extract who/what/when about your content. Add at least Organization (site-wide) and Article/Product (per page).`,
      fixSnippet: `<script type="application/ld+json">\n${JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Your Site Name",
          url: new URL(page.finalUrl).origin,
          logo: `${new URL(page.finalUrl).origin}/logo.png`,
          sameAs: [
            "https://www.linkedin.com/company/your-handle",
            "https://twitter.com/your-handle",
          ],
        },
        null,
        2,
      )}\n</script>`,
    });
    return findings;
  }

  const presentTypes = new Set<string>();
  for (const n of page.jsonLd) for (const t of typesOf(n)) presentTypes.add(t);

  // Quality per type
  for (const node of page.jsonLd) {
    if (!node || typeof node !== "object") continue;
    const types = typesOf(node);
    if (types.includes("Article") || types.includes("BlogPosting") || types.includes("NewsArticle")) {
      const missing: string[] = [];
      if (!node.author) missing.push("author");
      if (!node.datePublished) missing.push("datePublished");
      // schema.org inherits name from Thing; many CMSs populate name not
      // headline. Accept either rather than flag a -10 on a technicality (M6).
      if (!node.headline && !node.name) missing.push("headline");
      if (missing.length) {
        findings.push({
          id: `schema.article-incomplete:${page.finalUrl}`,
          status: "warn",
          severity: "important",
          discipline: "ai-seo",
          title: `Article schema is missing: ${missing.join(", ")}`,
          message:
            `Your Article/BlogPosting JSON-LD on ${page.url} omits ${missing.join(", ")}. AI assistants use these to attribute the content. Add them.`,
        });
      }
    }
    if (types.includes("Organization")) {
      const missing: string[] = [];
      if (!node.name) missing.push("name");
      if (!node.url) missing.push("url");
      if (!node.logo) missing.push("logo");
      if (!node.sameAs) missing.push("sameAs (social profiles)");
      if (missing.length) {
        findings.push({
          id: "schema.org-incomplete",
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          title: `Organization schema is missing: ${missing.join(", ")}`,
          message:
            `Add the missing fields. sameAs (links to your LinkedIn, Wikipedia, GitHub, etc.) is especially valuable as a knowledge-graph signal.`,
        });
      }
    }
    if (types.includes("Product")) {
      const missing: string[] = [];
      if (!node.name) missing.push("name");
      if (!node.offers) missing.push("offers");
      if (missing.length) {
        findings.push({
          id: `schema.product-incomplete:${page.finalUrl}`,
          status: "warn",
          severity: "important",
          discipline: "ai-seo",
          title: `Product schema missing: ${missing.join(", ")}`,
          message: `Add the missing fields so AI shopping assistants can compare your product accurately.`,
        });
      }
    }
    if (types.includes("FAQPage")) {
      const items = (node as any).mainEntity;
      const count = Array.isArray(items) ? items.length : items ? 1 : 0;
      if (count < 2) {
        findings.push({
          id: `schema.faq-thin:${page.finalUrl}`,
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          title: "FAQ schema has fewer than 2 questions",
          message: `Add at least 2-3 Q&A pairs so AI assistants can extract a meaningful set. Note that Google no longer shows FAQ rich results in regular search, so the value here is AI extraction, not classic SERP appearance.`,
        });
      }
    }
  }

  // Microdata / RDFa fallback note (informational pass, no penalty)
  if (page.jsonLdRawCount === 0 && (page.hasMicrodata || page.hasRdfa)) {
    findings.push({
      id: "schema.uses-microdata",
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "Site uses microdata/RDFa instead of JSON-LD",
      message:
        `${page.url} uses ${page.hasMicrodata ? "microdata" : "RDFa"} for structured data. JSON-LD is the preferred format for AI assistants and Google; consider migrating.`,
    });
  }

  return findings;
}
