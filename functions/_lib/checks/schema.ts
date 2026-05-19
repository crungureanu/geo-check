import type { CheckContext, Finding } from "../types";
import { sig } from "./_signal";

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
  const u = page.finalUrl;

  // Transactional/auth (B13) and boilerplate legal/policy (B14) pages are
  // not citation targets, so "no structured data here" is not a meaningful
  // gap: schema.present is NOT APPLICABLE (emit nothing). We still validate
  // any schema they do ship (the per-type checks below).
  const isNonCitation =
    ctx.pageInfo.type === "transactional" || ctx.pageInfo.type === "boilerplate";

  if (!isNonCitation) {
    if (page.jsonLdRawCount > 0) {
      findings.push(
        sig("schema.present", {
          status: "pass",
          severity: "important",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Structured data present",
          message: `${page.url} ships JSON-LD structured data.`,
        }),
      );
    } else if (page.hasMicrodata || page.hasRdfa) {
      findings.push(
        sig("schema.present", {
          status: "partial",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0.6,
          pageUrl: u,
          title: "Structured data uses microdata/RDFa, not JSON-LD",
          message: `${page.url} uses ${page.hasMicrodata ? "microdata" : "RDFa"}. JSON-LD is the format AI assistants and Google extract most reliably; consider migrating.`,
        }),
      );
    } else {
      findings.push(
        sig("schema.present", {
          status: "fail",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "No structured data on this page",
          message: `${page.url} has no JSON-LD, microdata, or RDFa. Structured data is how AI assistants reliably extract who/what/when about your content. Add at least Organization (site-wide) and Article/Product (per page).`,
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
        }),
      );
    }
  }

  // Per-type completeness. These signals only APPLY when the page actually
  // ships that schema type (content-presence applicability): a site with no
  // products is never graded on Product schema.
  for (const node of page.jsonLd) {
    if (!node || typeof node !== "object") continue;
    const types = typesOf(node);
    if (types.includes("Article") || types.includes("BlogPosting") || types.includes("NewsArticle")) {
      const req = ["author", "datePublished", "headline/name"];
      const missing: string[] = [];
      if (!node.author) missing.push("author");
      if (!node.datePublished) missing.push("datePublished");
      if (!node.headline && !node.name) missing.push("headline");
      const attainment = (req.length - missing.length) / req.length;
      findings.push(
        sig("schema.article", {
          status: missing.length ? "partial" : "pass",
          severity: "important",
          discipline: "ai-seo",
          attainment,
          pageUrl: u,
          title: missing.length ? `Article schema is missing: ${missing.join(", ")}` : "Article schema is complete",
          message: missing.length
            ? `Your Article/BlogPosting JSON-LD on ${page.url} omits ${missing.join(", ")}. AI assistants use these to attribute the content. Add them.`
            : `${page.url} has complete Article schema (author, date, headline).`,
        }),
      );
    }
    if (types.includes("Organization")) {
      const req = ["name", "url", "logo", "sameAs"];
      const missing: string[] = [];
      if (!node.name) missing.push("name");
      if (!node.url) missing.push("url");
      if (!node.logo) missing.push("logo");
      if (!node.sameAs) missing.push("sameAs (social profiles)");
      const attainment = (req.length - missing.length) / req.length;
      findings.push(
        sig("schema.org", {
          status: missing.length ? "partial" : "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment,
          pageUrl: u,
          title: missing.length ? `Organization schema is missing: ${missing.join(", ")}` : "Organization schema is complete",
          message: missing.length
            ? `Add the missing fields. sameAs (links to your LinkedIn, Wikipedia, GitHub, etc.) is especially valuable as a knowledge-graph signal.`
            : `${page.url} declares complete Organization schema.`,
        }),
      );
    }
    if (types.includes("Product")) {
      const req = ["name", "offers"];
      const missing: string[] = [];
      if (!node.name) missing.push("name");
      if (!node.offers) missing.push("offers");
      const attainment = (req.length - missing.length) / req.length;
      findings.push(
        sig("schema.product", {
          status: missing.length ? "partial" : "pass",
          severity: "important",
          discipline: "ai-seo",
          attainment,
          pageUrl: u,
          title: missing.length ? `Product schema missing: ${missing.join(", ")}` : "Product schema is complete",
          message: missing.length
            ? `Add the missing fields so AI shopping assistants can compare your product accurately.`
            : `${page.url} declares complete Product schema.`,
        }),
      );
    }
    if (types.includes("FAQPage")) {
      const items = (node as any).mainEntity;
      const count = Array.isArray(items) ? items.length : items ? 1 : 0;
      findings.push(
        sig("schema.faq", {
          status: count < 2 ? "partial" : "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: count < 2 ? 0 : 1,
          pageUrl: u,
          title: count < 2 ? "FAQ schema has fewer than 2 questions" : "FAQ schema is valid",
          message: count < 2
            ? `Add at least 2-3 Q&A pairs so AI assistants can extract a meaningful set. Note that Google no longer shows FAQ rich results in regular search, so the value here is AI extraction, not classic SERP appearance.`
            : `${page.url} ships a valid FAQPage with ${count} questions.`,
        }),
      );
    }
  }

  return findings;
}
