import type { CheckContext, Finding } from "../types";

const STOP_SCHEMA_FIXES = new Set(["WebSite", "WebPage", "Person"]);

function suggestNextSchema(presentTypes: Set<string>, hasArticle: boolean, hasProduct: boolean, hasFaq: boolean): { type: string; snippet: string } | null {
  if (!presentTypes.has("Organization")) {
    return {
      type: "Organization",
      snippet: JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Your Site Name",
          url: "https://yoursite.com",
          logo: "https://yoursite.com/logo.png",
          sameAs: ["https://www.linkedin.com/company/your-handle"],
        },
        null,
        2,
      ),
    };
  }
  if (hasArticle && !presentTypes.has("Article") && !presentTypes.has("BlogPosting")) {
    return {
      type: "Article",
      snippet: JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Article title",
          author: { "@type": "Person", name: "Author Name" },
          datePublished: "2026-05-15",
          dateModified: "2026-05-15",
        },
        null,
        2,
      ),
    };
  }
  if (hasFaq && !presentTypes.has("FAQPage")) {
    return {
      type: "FAQPage",
      snippet: JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            { "@type": "Question", name: "Your question?", acceptedAnswer: { "@type": "Answer", text: "Short answer." } },
          ],
        },
        null,
        2,
      ),
    };
  }
  if (hasProduct && !presentTypes.has("Product")) {
    return {
      type: "Product",
      snippet: JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Product name",
          offers: { "@type": "Offer", price: "0.00", priceCurrency: "USD" },
        },
        null,
        2,
      ),
    };
  }
  return null;
}

export function extrasChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  // URL hygiene (home only)
  if (ctx.isHome) {
    const u = new URL(page.finalUrl);
    if (u.search) {
      findings.push({
        id: "extras.home-url-querystring",
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        title: "Home page URL contains query parameters",
        message:
          `Your canonical home URL is ${page.finalUrl}. Clean it to the bare origin so AI assistants don't fragment your authority across variants.`,
      });
    }
  }

  // Suggest the next-most-missing schema (only on home, as a wedge)
  if (ctx.isHome) {
    const present = new Set<string>();
    for (const n of page.jsonLd) {
      const t = (n as any)["@type"];
      if (typeof t === "string") present.add(t);
      else if (Array.isArray(t)) for (const x of t) present.add(String(x));
    }
    const hasArticle = page.hasArticle || page.headings.some((h) => h.level === 1);
    const hasFaq = page.qaHeadings >= 3;
    const hasProduct = present.has("Product");
    const suggestion = suggestNextSchema(present, hasArticle, false, hasFaq);
    if (suggestion && !STOP_SCHEMA_FIXES.has(suggestion.type)) {
      findings.push({
        id: "extras.next-schema",
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        title: `Quick win: add ${suggestion.type} schema`,
        message:
          `Drop the snippet below into your home page <head>. AI assistants use this to attribute and contextualise your site.`,
        fixSnippet: `<script type="application/ld+json">\n${suggestion.snippet}\n</script>`,
      });
    }
  }

  return findings;
}
