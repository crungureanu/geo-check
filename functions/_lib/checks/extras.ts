import type { CheckContext, Finding } from "../types";
import { sig } from "./_signal";

// Any of these schemas counts as a valid identity declaration for a home page.
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
  if (!ctx.isHome) return findings;

  // URL hygiene (home only)
  const hasQuery = !!new URL(page.finalUrl).search;
  findings.push(
    hasQuery
      ? sig("extras.home-url", {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0,
          title: "Home page URL contains query parameters",
          message: `Your canonical home URL is ${page.finalUrl}. Clean it to the bare origin so AI assistants don't fragment your authority across variants.`,
        })
      : sig("extras.home-url", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 1,
          title: "Clean home URL",
          message: `The home page resolves to a clean origin URL.`,
        }),
  );

  // Identity schema on the home page.
  const present = new Set<string>();
  for (const n of page.jsonLd) {
    const t = (n as any)["@type"];
    if (typeof t === "string") present.add(t);
    else if (Array.isArray(t)) for (const x of t) present.add(String(x));
  }
  const hasIdentity = [...present].some((t) => IDENTITY_SCHEMAS.has(t));
  findings.push(
    !hasIdentity
      ? sig("extras.identity-schema", {
          status: "warn",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0,
          title: "No identity schema (Organization or Person) on the home page",
          message: `Your home page has no Organization, Person, or LocalBusiness JSON-LD. AI assistants use these to know who you are. Pick whichever fits: a company -> Organization, a personal site -> Person, a venue with an address -> LocalBusiness.`,
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
        })
      : sig("extras.identity-schema", {
          status: "pass",
          severity: "important",
          discipline: "ai-seo",
          attainment: 1,
          title: "Identity schema present on the home page",
          message: `The home page declares an identity schema (Organization/Person/LocalBusiness).`,
        }),
  );

  return findings;
}
