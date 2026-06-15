export type CheckStatus = "pass" | "partial" | "warn" | "fail";
export type Severity = "blocking" | "important" | "nice";
export type Discipline = "ai-seo" | "classic-seo" | "both";

export type PageType =
  | "home"
  | "about"
  | "contact"
  | "service"
  | "product"
  | "article"
  | "faq"
  | "pricing"
  | "transactional"
  | "boilerplate"
  | "other";

export interface Finding {
  id: string;
  status: CheckStatus;
  severity: Severity;
  discipline: Discipline;
  title: string;
  message: string;
  fixSnippet?: string;
  affectedPages?: string[];
  // Scoring model (weighted attainment over APPLICABLE signals).
  // weight: relative importance of this signal for its discipline.
  //   Omitted/0 => the finding is a non-scoring note (context.*, fetch.*).
  // attainment: 0..1 how much of the signal is earned. If omitted the
  //   scorer derives it from status (pass=1, partial=0.5, warn/fail=0).
  // gateCap: if this finding is a failed gate, the discipline score is
  //   capped at this value (lowest applicable cap wins).
  weight?: number;
  attainment?: number;
  gateCap?: number;
}

export interface PageInfo {
  url: string;
  type: PageType;
  status: number;
}

export interface ScanScores {
  aiSeo: number;
  classicSeo: number;
  // Bar-3 (Content depth) score. Optional + additive: present on scans
  // run after the tier-ladder release, absent on older stored reports
  // (renderer treats absence as "not scanned"). Stored in full in KV;
  // the API strips it from responses unless a valid connection token
  // is presented (the email-unlock gate).
  content?: number;
}

export interface DeepLink {
  label: string;
  url: string;
}

// Version of the persisted ScanResult shape. Bump ONLY on a breaking
// shape change (removed/renamed field, changed semantics of an existing
// field that would mis-render). Additive optional fields do not bump.
// Saved share links live 7 days; if you bump, also add a frontend guard
// that handles older values gracefully so in-flight shares do not crash.
export const SCHEMA_VERSION = 1;

export interface ScanResult {
  id?: string;
  // Present on KV-persisted reports (set in saveScan/updateScan). Absent
  // on in-memory results that were never persisted (stateless /api/speed
  // path, offline harness output). Treat undefined as version 1.
  schemaVersion?: number;
  url: string;
  scannedPages: PageInfo[];
  scores: ScanScores;
  findings: Finding[];
  // Bar-3 (Content depth) findings, kept separate from `findings` so the
  // email-unlock gate can strip them in one move and so they never feed
  // the aiSeo/classicSeo scores. Same additive/optional contract as
  // scores.content (see SCHEMA_VERSION note: additive fields, no bump).
  contentFindings?: Finding[];
  // Signals that did not apply to this site (e.g. Product schema on a site
  // with no products, FAQ schema with no Q&A content). Listed so the score
  // denominator is transparent: we only grade what the page should be doing.
  notApplicable: { id: string; title: string; discipline: Discipline }[];
  deepLinks: DeepLink[];
  scannedAt: string;
  ttl: number;
  // Optional so it is omitted from JSON when PageSpeed did not run
  // (e.g. the offline harness has no key): keeps strict goldens
  // byte-identical. Present only in production with a key.
  performance?: {
    mobile: PageSpeedMetrics | null;
    desktop: PageSpeedMetrics | null;
  };
}

export interface FetchedDoc {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  headers: Record<string, string>;
  body: string;
  redirectChain: number;
  fetchError?: string;
}

export interface RootFiles {
  robots: FetchedDoc | null;
  sitemap: FetchedDoc | null;
  sitemapUrl: string | null;
  llmsTxt: FetchedDoc | null;
  faviconIcoReachable: boolean;
}

export interface PageData {
  url: string;
  finalUrl: string;
  status: number;
  redirectChain: number;
  rawBytes: number;
  contentType: string | null;
  headers: Record<string, string>;
  fetchError?: string; // carried from FetchedDoc so A1 can identify budget-skipped pages

  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  metaAuthor: string | null;
  metaViewport: string | null;
  canonical: string | null;
  lang: string | null;
  hasFavicon: boolean;
  hasAppleTouchIcon: boolean;

  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  twitterCard: string | null;
  // Bar-3 social-card depth (additive, 2026-06-12)
  ogImageWidth: string | null;
  ogImageHeight: string | null;
  ogImageAlt: string | null;
  ogSiteName: string | null;
  twitterImage: string | null;

  h1Count: number;
  headings: Array<{ level: number; text: string }>;
  hasArticle: boolean;
  hasMain: boolean;

  imgCount: number;
  imgWithAlt: number;
  imgMissingAlt: string[];

  // Mixed content (Wave 2a): http:// sub-resources referenced on an HTTPS
  // page. Counts loaded resources only (img/script/stylesheet/media/iframe),
  // never <a href> navigation links or http:// in text / JSON-LD @context.
  insecureResourceCount: number;
  insecureResourceExamples: string[];

  jsonLd: any[];
  jsonLdRawCount: number;
  hasMicrodata: boolean;
  hasRdfa: boolean;

  bodyText: string;
  // First ~3000 chars of the text inside <main>/<article> when present
  // (falls back to body text). Used by bar-3's entity-statement check so
  // a long navigation menu does not eat the "first 300 words" window.
  leadText: string;
  wordCount: number;
  textToCodeRatio: number;

  outboundDomains: string[];
  authoritativeOutboundCount: number;
  internalLinkCount: number;

  bylineCandidates: string[];
  dateCandidates: string[];

  qaHeadings: number;
  faqHeadings: number;
  listCount: number;
  tableCount: number;
  // Per-section stats for bar-3 citable-passage analysis: each h2/h3 with
  // the word count of the text that follows it (until the next heading).
  sections: Array<{ heading: string; level: number; question: boolean; words: number }>;

  pagespeed?: PageSpeedMetrics | null; // mobile strategy
  pagespeedDesktop?: PageSpeedMetrics | null; // desktop strategy
}

export interface PageSpeedMetrics {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  performanceScore: number | null;
  fetched: boolean;
  error?: string;
}

export interface CheckContext {
  page: PageData;
  pageInfo: PageInfo;
  rootFiles: RootFiles;
  isHome: boolean;
  // Epoch ms used as "now" by time-dependent checks (freshness, recency).
  // Injected so the offline harness can freeze it and keep goldens stable
  // across calendar years; production passes Date.now().
  now: number;
}
