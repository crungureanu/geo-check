import type { CheckContext, Finding } from "../types";
import { sig } from "./_signal";
import { isSectionIndex } from "../page-selector";

// Bar 3: Content depth ("is it good enough to get cited"). These findings
// go to ScanResult.contentFindings and feed scores.content ONLY - never
// aiSeo/classicSeo. Presence checks live in bar 1; everything here assumes
// the thing exists and judges its quality, so most signals emit nothing
// (not applicable) when the underlying feature is absent.

// Hosts that establish a verifiable identity for Organization.sameAs.
const IDENTITY_HOSTS = [
  "wikipedia.org",
  "wikidata.org",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "github.com",
  "crunchbase.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
];

function identityHost(u: string): boolean {
  try {
    const h = new URL(u).host.toLowerCase().replace(/^www\./, "");
    return IDENTITY_HOSTS.some((base) => h === base || h.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

function nodeTypes(n: any): string[] {
  const t = n?.["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string");
  return [];
}

const ARTICLE_TYPES = new Set(["Article", "BlogPosting", "NewsArticle", "TechArticle"]);
const ORG_TYPES = new Set(["Organization", "LocalBusiness", "Corporation", "Person"]);

export function contentDepthChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;
  const u = page.finalUrl;
  const isIndexPage = isSectionIndex(page.url) || isSectionIndex(page.finalUrl);

  // ---- content.citable-passage ----
  // Judge the answer blocks under question-shaped h2/h3 headings. The ideal
  // citable passage is a self-contained 115-180 word answer; 80-250 words
  // still works; thinner or much longer sections rarely get lifted whole.
  // Applicable on content pages that HAVE question headings (presence of
  // question headings at all is bar 1's answer.question-headings).
  const qSections = page.sections.filter((s) => s.question);
  if (!isIndexPage && page.wordCount > 200 && qSections.length > 0) {
    const ideal = qSections.filter((s) => s.words >= 115 && s.words <= 180).length;
    const ok = qSections.filter((s) => s.words >= 80 && s.words <= 250).length;
    if (ideal > 0) {
      findings.push(
        sig("content.citable-passage", {
          status: "pass",
          severity: "important",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Citable answer passages found",
          message: `${page.url} has ${ideal} section${ideal === 1 ? "" : "s"} with a self-contained answer in the 115-180 word range AI assistants lift most readily.`,
        }),
      );
    } else if (ok > 0) {
      findings.push(
        sig("content.citable-passage", {
          status: "partial",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0.6,
          pageUrl: u,
          title: "Answer sections are close to citable length",
          message: `${page.url} answers its question headings in sections of 80-250 words, but none lands in the 115-180 word sweet spot. Tighten one answer per question to a self-contained 115-180 word passage that works when quoted alone.`,
        }),
      );
    } else {
      const thin = qSections.filter((s) => s.words < 80).length;
      findings.push(
        sig("content.citable-passage", {
          status: "warn",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0.2,
          pageUrl: u,
          title: thin === qSections.length ? "Answers under question headings are too thin to cite" : "No section is shaped like a citable passage",
          message: `${page.url} has ${qSections.length} question-shaped heading${qSections.length === 1 ? "" : "s"}, but the text under ${qSections.length === 1 ? "it" : "them"} is ${thin === qSections.length ? "under 80 words" : "outside the 80-250 word range"}. Write one self-contained 115-180 word answer directly under each question so an AI assistant can quote it without surrounding context.`,
        }),
      );
    }
  }

  // ---- content.entity-statement ----
  // Home page only: does the first ~300 words say what the brand IS?
  // ("X is a Y that Z"). This is what lets an assistant define you.
  if (ctx.isHome && page.wordCount > 50) {
    const brandNames: string[] = [];
    for (const node of page.jsonLd) {
      if (nodeTypes(node).some((t) => ORG_TYPES.has(t)) && typeof (node as any).name === "string") {
        brandNames.push((node as any).name);
      }
    }
    if (page.ogSiteName) brandNames.push(page.ogSiteName);
    if (page.title) {
      // Brands sit on either side of the separator ("Acme - Billing" /
      // "Car Leasing Deals - Select Car Leasing"): try both ends.
      const parts = page.title.split(/[|\-–:]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) brandNames.push(parts[0]);
      if (parts.length > 1) brandNames.push(parts[parts.length - 1]);
    }
    try {
      brandNames.push(new URL(u).hostname.replace(/^www\./, "").split(".")[0]);
    } catch {}

    const first300 = (page.leadText || page.bodyText)
      .split(/\s+/).slice(0, 300).join(" ").toLowerCase();
    const verbs = "(is|are|helps?|provides?|offers?|builds?|makes?|creates?|delivers?|specialises?|specializes?)";
    const found = brandNames.some((b) => {
      const name = b.trim().toLowerCase();
      if (name.length < 2) return false;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`${esc}[^.!?]{0,60}\\b${verbs}\\b`, "i").test(first300);
    });
    findings.push(
      found
        ? sig("content.entity-statement", {
            status: "pass",
            severity: "important",
            discipline: "ai-seo",
            attainment: 1,
            title: "Clear entity statement near the top",
            message: `The home page states what the brand is/does within the first 300 words, which is what AI assistants use to define you.`,
          })
        : sig("content.entity-statement", {
            status: "warn",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0,
            title: "No clear entity statement in the first 300 words",
            message: `The home page never plainly says what the brand is within its opening 300 words. Add one sentence of the form "<Brand> is a <category> that <what it does> for <who>". AI assistants lean on this exact pattern when deciding how to describe and whether to cite you.`,
            fixSnippet: `<p><strong>Acme</strong> is a billing platform that automates invoicing for small agencies.</p>`,
          }),
    );
  }

  // ---- content.identity-sameas ----
  // Home page, only when an Organization-ish node exists (presence of the
  // node itself is bar 1's extras.identity-schema). Validates that sameAs
  // points at 2+ recognised identity hosts.
  if (ctx.isHome) {
    const orgNodes = page.jsonLd.filter((n) => nodeTypes(n).some((t) => ORG_TYPES.has(t)));
    if (orgNodes.length > 0) {
      const sameAs: string[] = [];
      for (const n of orgNodes) {
        const s = (n as any).sameAs;
        if (typeof s === "string") sameAs.push(s);
        else if (Array.isArray(s)) for (const x of s) if (typeof x === "string") sameAs.push(x);
      }
      const valid = sameAs.filter(identityHost).length;
      if (valid >= 2) {
        findings.push(
          sig("content.identity-sameas", {
            status: "pass",
            severity: "important",
            discipline: "ai-seo",
            attainment: 1,
            title: "Identity is verifiable via sameAs",
            message: `The Organization schema links ${valid} recognised identity profiles (Wikipedia/Wikidata/LinkedIn/X/GitHub/Crunchbase and similar), which lets AI assistants confirm who you are.`,
          }),
        );
      } else if (valid === 1) {
        findings.push(
          sig("content.identity-sameas", {
            status: "partial",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0.5,
            title: "Only one verifiable identity link",
            message: `The Organization schema's sameAs has just one recognised identity host. Add at least one more (LinkedIn, Wikipedia/Wikidata, X, GitHub or Crunchbase) so assistants can cross-check your identity.`,
            fixSnippet: `"sameAs": [\n  "https://www.linkedin.com/company/your-company",\n  "https://github.com/your-org"\n]`,
          }),
        );
      } else {
        findings.push(
          sig("content.identity-sameas", {
            status: "warn",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0,
            title: sameAs.length > 0 ? "sameAs links are not verifiable identity hosts" : "Organization schema has no sameAs links",
            message:
              sameAs.length > 0
                ? `The Organization schema has sameAs links, but none point at hosts AI assistants use to verify identity. Add 2+ of: Wikipedia, Wikidata, LinkedIn, X, GitHub, Crunchbase.`
                : `The Organization schema has no sameAs array. Add 2+ links to your official profiles (LinkedIn, Wikipedia/Wikidata, X, GitHub, Crunchbase) so assistants can verify the entity behind the site.`,
            fixSnippet: `"sameAs": [\n  "https://www.linkedin.com/company/your-company",\n  "https://en.wikipedia.org/wiki/Your_Company"\n]`,
          }),
        );
      }
    }
  }

  // ---- content.date-modified ----
  // Article pages with Article schema (presence is bar 1's schema.article):
  // is the date trail complete enough to prove freshness?
  if (ctx.pageInfo.type === "article" && !isIndexPage) {
    const artNodes = page.jsonLd.filter((n) => nodeTypes(n).some((t) => ARTICLE_TYPES.has(t)));
    if (artNodes.length > 0) {
      const hasMod = artNodes.some((n) => typeof (n as any).dateModified === "string" && !isNaN(Date.parse((n as any).dateModified)));
      const hasPub = artNodes.some((n) => typeof (n as any).datePublished === "string" && !isNaN(Date.parse((n as any).datePublished)));
      const bareAuthor = artNodes.some((n) => typeof (n as any).author === "string");
      const authorNote = bareAuthor
        ? ` Also: the author is a bare string; make it an object ("author": { "@type": "Person", "name": "..." }) so assistants can attribute properly.`
        : "";
      if (hasMod && hasPub) {
        findings.push(
          sig("content.date-modified", {
            status: bareAuthor ? "partial" : "pass",
            severity: "important",
            discipline: "ai-seo",
            attainment: bareAuthor ? 0.8 : 1,
            pageUrl: u,
            title: "Article date trail is complete",
            message: `${page.url} carries both datePublished and dateModified in its Article schema, so assistants can judge freshness.${authorNote}`,
          }),
        );
      } else if (hasPub) {
        findings.push(
          sig("content.date-modified", {
            status: "partial",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0.5,
            pageUrl: u,
            title: "Article schema lacks dateModified",
            message: `${page.url} has datePublished but no dateModified. Assistants treat an article without a modified date as potentially stale; add dateModified and update it when you revise the page.${authorNote}`,
            fixSnippet: `"datePublished": "2026-01-10",\n"dateModified": "2026-06-12"`,
          }),
        );
      } else {
        findings.push(
          sig("content.date-modified", {
            status: "warn",
            severity: "important",
            discipline: "ai-seo",
            attainment: 0,
            pageUrl: u,
            title: "Article schema has no valid dates",
            message: `${page.url} has Article schema but neither datePublished nor dateModified parses as a date. Add both in ISO format (YYYY-MM-DD).${authorNote}`,
            fixSnippet: `"datePublished": "2026-01-10",\n"dateModified": "2026-06-12"`,
          }),
        );
      }
    }
  }

  // ---- content.og-depth ----
  // Pages that HAVE an og:image (presence is bar 1's seo.open-graph): is
  // the social/AI preview card actually complete?
  if (page.ogImage) {
    let score = 0;
    const gaps: string[] = [];
    const absolute = /^https?:\/\//i.test(page.ogImage);
    if (absolute) score += 0.4;
    else gaps.push("og:image is not an absolute URL");
    if (page.ogImageWidth && page.ogImageHeight) score += 0.2;
    else gaps.push("og:image:width/height missing (cards render slower on first share)");
    if (page.ogImageAlt) score += 0.1;
    else gaps.push("og:image:alt missing");
    const validCards = new Set(["summary", "summary_large_image", "app", "player"]);
    if (page.twitterCard && validCards.has(page.twitterCard.trim().toLowerCase())) {
      score += 0.15;
      // twitter:image may fall back to an absolute og:image; the card only
      // breaks when neither exists.
      if (page.twitterImage || absolute) score += 0.15;
      else gaps.push("twitter card has no usable image (no twitter:image, og:image not absolute)");
    } else {
      gaps.push(page.twitterCard ? `twitter:card value "${page.twitterCard}" is invalid` : "twitter:card missing");
    }
    const att = Math.min(1, +score.toFixed(2));
    findings.push(
      sig("content.og-depth", {
        status: att >= 0.95 ? "pass" : att >= 0.5 ? "partial" : "warn",
        severity: "nice",
        discipline: "ai-seo",
        attainment: att,
        pageUrl: u,
        title: att >= 0.95 ? "Social card markup is complete" : "Social card markup is incomplete",
        message:
          att >= 0.95
            ? `${page.url} has a fully specified preview card (absolute og:image with dimensions, alt text and a valid Twitter card).`
            : `${page.url}'s preview card has gaps: ${gaps.join("; ")}. Complete cards control how the page looks when assistants and people share it.`,
        fixSnippet:
          att >= 0.95
            ? undefined
            : `<meta property="og:image" content="https://example.com/cover.jpg" />\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />\n<meta property="og:image:alt" content="What the image shows" />\n<meta name="twitter:card" content="summary_large_image" />`,
      }),
    );
  }

  // ---- content.breadcrumbs ----
  // Pages that HAVE a BreadcrumbList: is it valid (positions contiguous,
  // each item named)? Absence emits nothing - breadcrumbs are optional.
  const crumbs = page.jsonLd.filter((n) => nodeTypes(n).includes("BreadcrumbList"));
  if (crumbs.length > 0) {
    const problems: string[] = [];
    for (const c of crumbs) {
      const items = (c as any).itemListElement;
      if (!Array.isArray(items) || items.length === 0) {
        problems.push("itemListElement is missing or empty");
        continue;
      }
      const positions: number[] = [];
      for (const it of items) {
        if (!it || typeof it !== "object") { problems.push("a list item is not an object"); continue; }
        const pos = Number(it.position);
        if (!Number.isFinite(pos)) problems.push("a list item has no numeric position");
        else positions.push(pos);
        const name = it.name ?? (typeof it.item === "object" ? it.item?.name : undefined);
        if (typeof name !== "string" || !name.trim()) problems.push(`item at position ${it.position ?? "?"} has no name`);
      }
      positions.sort((a, b) => a - b);
      for (let i = 0; i < positions.length; i++) {
        if (positions[i] !== i + 1) { problems.push(`positions are not contiguous 1..${positions.length}`); break; }
      }
    }
    findings.push(
      problems.length === 0
        ? sig("content.breadcrumbs", {
            status: "pass",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 1,
            pageUrl: u,
            title: "Breadcrumb markup is valid",
            message: `${page.url}'s BreadcrumbList validates: contiguous positions, every item named.`,
          })
        : sig("content.breadcrumbs", {
            status: "warn",
            severity: "nice",
            discipline: "ai-seo",
            attainment: 0.3,
            pageUrl: u,
            title: "Breadcrumb markup has validation errors",
            message: `${page.url} has a BreadcrumbList but it does not validate: ${[...new Set(problems)].slice(0, 4).join("; ")}. Invalid breadcrumbs are ignored by search and AI crawlers, so fix or remove them.`,
            fixSnippet: `{\n  "@type": "BreadcrumbList",\n  "itemListElement": [\n    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com/" },\n    { "@type": "ListItem", "position": 2, "name": "Guides", "item": "https://example.com/guides/" }\n  ]\n}`,
          }),
    );
  }

  return findings;
}
