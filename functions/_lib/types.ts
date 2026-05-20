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

  h1Count: number;
  headings: Array<{ level: number; text: string }>;
  hasArticle: boolean;
  hasMain: boolean;

  imgCount: number;
  imgWithAlt: number;
  imgMissingAlt: string[];

  jsonLd: any[];
  jsonLdRawCount: number;
  hasMicrodata: boolean;
  hasRdfa: boolean;

  bodyText: string;
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
}
