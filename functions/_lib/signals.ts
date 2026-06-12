import type { Discipline } from "./types";

// Single source of truth for the scoring model. Every scoreable signal has
// ONE stable finding id (status/attainment vary; never a separate id for the
// pass vs fail case, so per-page dedupe aggregates correctly). weight is the
// signal's relative importance for its discipline. A signal is APPLICABLE to
// a scan iff a finding with its id is emitted; signals never emitted (gated
// out by page type or absent content) are reported as "not applicable" and
// are in neither the numerator nor the denominator.
//
// gateCap: when this signal's aggregated status is a failure, the discipline
// score is capped at gateCap (lowest applicable cap wins). Honest reporting:
// if AI crawlers are blocked or the page is noindex, no amount of schema or
// copy quality earns a high score.

export interface SignalDef {
  id: string;
  title: string;
  discipline: Discipline;
  weight: number;
  gateCap?: number;
}

export const SIGNALS: SignalDef[] = [
  // ----- Crawler access / indexability -----
  // These are GATES: failing them caps the score hard (gateCap). They are
  // table stakes ("your site loads and is crawlable"), not a differentiator,
  // so passing them carries only a small positive weight. Otherwise a
  // content-empty but reachable site banks ~30 free points before any
  // quality is measured (this is what made weak sites score ~85).
  { id: "robots.ai-access", title: "AI crawlers can read the site", discipline: "ai-seo", weight: 3, gateCap: 25 },
  { id: "robots.indexable", title: "Page is indexable (no noindex)", discipline: "both", weight: 3, gateCap: 20 },
  // ----- Discoverability -----
  { id: "discovery.sitemap", title: "Sitemap is reachable", discipline: "both", weight: 6 },
  { id: "discovery.https", title: "Served over HTTPS", discipline: "both", weight: 3, gateCap: 50 },
  { id: "discovery.llms-txt", title: "llms.txt present", discipline: "ai-seo", weight: 2 },
  { id: "discovery.hsts", title: "HSTS header", discipline: "classic-seo", weight: 1 },
  { id: "discovery.canonical", title: "Canonical tag", discipline: "classic-seo", weight: 3 },
  { id: "discovery.lang", title: "Lang attribute", discipline: "ai-seo", weight: 2 },
  { id: "discovery.redirect", title: "No redirect chain", discipline: "classic-seo", weight: 1 },
  // ----- Structured data -----
  { id: "schema.present", title: "Structured data present", discipline: "ai-seo", weight: 12 },
  { id: "schema.article", title: "Article schema complete", discipline: "ai-seo", weight: 5 },
  { id: "schema.org", title: "Organization schema complete", discipline: "ai-seo", weight: 3 },
  { id: "schema.product", title: "Product schema complete", discipline: "ai-seo", weight: 5 },
  { id: "schema.faq", title: "FAQ schema valid", discipline: "ai-seo", weight: 2 },
  { id: "extras.identity-schema", title: "Identity schema on home", discipline: "ai-seo", weight: 8 },
  // ----- Content substance -----
  { id: "extract.content", title: "Enough body text to cite", discipline: "ai-seo", weight: 12 },
  { id: "extract.h1", title: "Has an <h1>", discipline: "both", weight: 4 },
  { id: "extract.heading-hierarchy", title: "Clean heading hierarchy", discipline: "ai-seo", weight: 2 },
  { id: "extract.landmark", title: "Content landmark (<main>/<article>)", discipline: "ai-seo", weight: 3 },
  { id: "extract.image-alt", title: "Image alt-text coverage", discipline: "ai-seo", weight: 3 },
  { id: "extract.text-ratio", title: "Reasonable text-to-code ratio", discipline: "ai-seo", weight: 1 },
  // ----- Citability -----
  { id: "cite.author", title: "Author attribution", discipline: "ai-seo", weight: 6 },
  { id: "cite.date", title: "Publish / update date", discipline: "ai-seo", weight: 5 },
  { id: "cite.outbound", title: "Sources its claims", discipline: "ai-seo", weight: 3 },
  { id: "cite.internal-links", title: "Internal linking", discipline: "classic-seo", weight: 2 },
  // ----- Answer shape -----
  { id: "answer.question-headings", title: "Question-shaped headings", discipline: "ai-seo", weight: 2 },
  { id: "answer.lists", title: "Lists / tables", discipline: "ai-seo", weight: 3 },
  { id: "answer.faq-schema", title: "Q&A marked up as FAQ", discipline: "ai-seo", weight: 2 },
  // ----- Classic SEO -----
  { id: "seo.title", title: "Title tag", discipline: "classic-seo", weight: 8 },
  { id: "seo.meta-desc", title: "Meta description", discipline: "classic-seo", weight: 5 },
  { id: "seo.viewport", title: "Mobile viewport", discipline: "classic-seo", weight: 6 },
  { id: "seo.open-graph", title: "Open Graph tags", discipline: "both", weight: 2 },
  { id: "seo.twitter-card", title: "Twitter Card", discipline: "classic-seo", weight: 1 },
  { id: "seo.favicon", title: "Favicon", discipline: "classic-seo", weight: 1 },
  { id: "seo.apple-touch-icon", title: "Apple touch icon", discipline: "classic-seo", weight: 1 },
  { id: "seo.cwv", title: "Core Web Vitals", discipline: "classic-seo", weight: 8 },
  { id: "extras.home-url", title: "Clean home URL", discipline: "ai-seo", weight: 1 },
];

// ----- Bar 3: Content depth (email-unlocked) -----
// Scored SEPARATELY from aiSeo/classicSeo: these findings live in
// ScanResult.contentFindings and feed scores.content only. Presence-vs-
// depth rule: bar 1 asks "do you have it", these ask "is it good enough
// to get cited". Weights are relative within this catalog only.
export const CONTENT_SIGNALS: SignalDef[] = [
  { id: "content.citable-passage", title: "Citable answer passages", discipline: "ai-seo", weight: 25 },
  { id: "content.entity-statement", title: "Clear entity statement up front", discipline: "ai-seo", weight: 15 },
  { id: "content.identity-sameas", title: "Verifiable identity links (sameAs)", discipline: "ai-seo", weight: 15 },
  { id: "content.date-modified", title: "Article dates are complete", discipline: "ai-seo", weight: 15 },
  { id: "content.og-depth", title: "Social card depth", discipline: "ai-seo", weight: 15 },
  { id: "content.breadcrumbs", title: "Breadcrumb markup is valid", discipline: "ai-seo", weight: 15 },
];

const BY_ID = new Map(
  [...SIGNALS, ...CONTENT_SIGNALS].map((s) => [s.id, s]),
);

export function signalDef(id: string): SignalDef | undefined {
  return BY_ID.get(id);
}

// Weight helper for the check modules so the weight lives in exactly one
// place. Returns 0 for ids that are not scored (context/* notes, fetch.*).
export function weightOf(id: string): number {
  return BY_ID.get(id)?.weight ?? 0;
}

export function gateCapOf(id: string): number | undefined {
  return BY_ID.get(id)?.gateCap;
}
