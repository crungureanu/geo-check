import type { CheckContext, Finding } from "../types";

// Any of these schemas counts as a valid identity declaration for a home page.
// Don't recommend Organization if the site already declares one of them.
const IDENTITY_SCHEMAS = new Set([
  "Organization",
  "Person",
  "LocalBusiness",
  "ProfessionalService",
  "Corporation",
  "EducationalOrganization",
  "GovernmentOrganization",
  "NGO",
  "Restaurant",
  "Store",
]);

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

  // Schema "next win" recommendation. The hard rule: only recommend a schema
  // type that is actually true for the page. Never propose Article on a
  // non-article page; that's structured-data spam and Google demotes it.
  if (ctx.isHome) {
    const present = new Set<string>();
    for (const n of page.jsonLd) {
      const t = (n as any)["@type"];
      if (typeof t === "string") present.add(t);
      else if (Array.isArray(t)) for (const x of t) present.add(String(x));
    }
    const hasIdentity = [...present].some((t) => IDENTITY_SCHEMAS.has(t));
    if (!hasIdentity) {
      findings.push({
        id: "extras.next-schema",
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        title: "Add an identity schema (Organization or Person) to the home page",
        message:
          `Your home page has no Organization, Person, or LocalBusiness JSON-LD. AI assistants use these to know who you are. Pick whichever fits: a company → Organization, a personal site → Person, a venue with an address → LocalBusiness.`,
        fixSnippet: `<script type="application/ld+json">\n${JSON.stringify(
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Your Site Name",
            url: new URL(page.finalUrl).origin,
            logo: `${new URL(page.finalUrl).origin}/logo.png`,
            sameAs: ["https://www.linkedin.com/company/your-handle"],
          },
          null,
          2,
        )}\n</script>`,
      });
    }
  }

  return findings;
}
