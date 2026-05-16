export type CheckStatus = "pass" | "warn" | "fail";
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

export interface ScanResult {
  id?: string;
  url: string;
  scannedPages: PageInfo[];
  scores: ScanScores;
  findings: Finding[];
  deepLinks: DeepLink[];
  scannedAt: string;
  ttl: number;
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
}

export interface PageData {
  url: string;
  finalUrl: string;
  status: number;
  redirectChain: number;
  rawBytes: number;
  contentType: string | null;
  headers: Record<string, string>;

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

  pagespeed?: PageSpeedMetrics | null;
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
