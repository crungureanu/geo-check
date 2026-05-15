import type { FetchedDoc, PageData } from "./types";

const AUTHORITATIVE_TLDS = [
  ".gov", ".edu", ".ac.uk", ".ac.jp", ".gouv.fr", ".gov.uk",
];
const AUTHORITATIVE_HOSTS = new Set([
  "en.wikipedia.org",
  "wikipedia.org",
  "schema.org",
  "www.w3.org",
  "w3.org",
  "developer.mozilla.org",
  "www.who.int",
  "www.nih.gov",
  "www.bbc.co.uk",
  "www.reuters.com",
  "apnews.com",
  "www.ap.org",
  "www.nytimes.com",
  "www.ft.com",
  "www.economist.com",
  "scholar.google.com",
  "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
]);

const QUESTION_STARTERS =
  /^(what|how|why|when|where|who|which|can|does|do|is|are|will|would|should|could|did|has|have)\b/i;

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(href: string, base: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

function isAuthoritative(host: string): boolean {
  if (AUTHORITATIVE_HOSTS.has(host)) return true;
  return AUTHORITATIVE_TLDS.some((tld) => host.endsWith(tld));
}

function emptyData(doc: FetchedDoc): PageData {
  return {
    url: doc.url,
    finalUrl: doc.finalUrl,
    status: doc.status,
    redirectChain: doc.redirectChain,
    rawBytes: doc.body.length,
    contentType: doc.contentType,
    headers: doc.headers,
    title: null,
    metaDescription: null,
    metaRobots: null,
    metaAuthor: null,
    metaViewport: null,
    canonical: null,
    lang: null,
    hasFavicon: false,
    hasAppleTouchIcon: false,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogType: null,
    twitterCard: null,
    h1Count: 0,
    headings: [],
    hasArticle: false,
    hasMain: false,
    imgCount: 0,
    imgWithAlt: 0,
    imgMissingAlt: [],
    jsonLd: [],
    jsonLdRawCount: 0,
    hasMicrodata: false,
    hasRdfa: false,
    bodyText: "",
    wordCount: 0,
    textToCodeRatio: 0,
    outboundDomains: [],
    authoritativeOutboundCount: 0,
    internalLinkCount: 0,
    bylineCandidates: [],
    dateCandidates: [],
    qaHeadings: 0,
    listCount: 0,
    tableCount: 0,
  };
}

export function extractPageData(doc: FetchedDoc): PageData {
  const data = emptyData(doc);
  if (!doc.ok || !doc.body) return data;

  const html = doc.body;
  const baseUrl = doc.finalUrl || doc.url;
  const baseHost = (() => {
    try { return new URL(baseUrl).host; } catch { return ""; }
  })();

  // <html lang="">
  const htmlTagMatch = html.match(/<html\b[^>]*>/i);
  if (htmlTagMatch) data.lang = attr(htmlTagMatch[0], "lang");

  // <title>
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) data.title = decodeEntities(titleMatch[1]).trim() || null;

  // <meta> tags
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const name = (attr(tag, "name") ?? "").toLowerCase();
    const property = (attr(tag, "property") ?? "").toLowerCase();
    const content = attr(tag, "content");
    if (!content) continue;
    if (name === "description") data.metaDescription = decodeEntities(content);
    else if (name === "robots") data.metaRobots = content;
    else if (name === "author") {
      data.metaAuthor = decodeEntities(content);
      data.bylineCandidates.push(decodeEntities(content));
    } else if (name === "viewport") data.metaViewport = content;
    else if (name === "twitter:card") data.twitterCard = content;
    else if (property === "og:title") data.ogTitle = decodeEntities(content);
    else if (property === "og:description") data.ogDescription = decodeEntities(content);
    else if (property === "og:image") data.ogImage = content;
    else if (property === "og:type") data.ogType = content;
    else if (property === "article:published_time" || name === "article:published_time")
      data.dateCandidates.push(content);
    else if (property === "article:modified_time" || name === "article:modified_time")
      data.dateCandidates.push(content);
  }

  // <link rel="...">
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel === "canonical") data.canonical = href;
    else if (rel === "icon" || rel === "shortcut icon") data.hasFavicon = true;
    else if (rel === "apple-touch-icon") data.hasAppleTouchIcon = true;
    else if (rel === "author") data.bylineCandidates.push(href);
  }

  // Headings
  for (let level = 1; level <= 6; level++) {
    const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
    let m;
    while ((m = re.exec(html))) {
      const text = decodeEntities(stripTags(m[1])).trim();
      if (!text) continue;
      data.headings.push({ level, text });
      if (level === 1) data.h1Count++;
      if (level >= 2 && level <= 3 && (QUESTION_STARTERS.test(text) || text.endsWith("?"))) {
        data.qaHeadings++;
      }
    }
  }

  // Semantic landmarks
  data.hasArticle = /<article\b/i.test(html);
  data.hasMain = /<main\b/i.test(html);

  // Microdata / RDFa
  data.hasMicrodata = /\bitemscope\b/i.test(html) && /\bitemtype\s*=/i.test(html);
  data.hasRdfa = /\b(typeof|vocab|property)\s*=/i.test(html) && /schema\.org/i.test(html);

  // Images
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  data.imgCount = imgTags.length;
  for (const tag of imgTags) {
    const alt = attr(tag, "alt");
    const src = attr(tag, "src") ?? "";
    if (alt !== null && alt.trim().length > 0) data.imgWithAlt++;
    else if (data.imgMissingAlt.length < 10) data.imgMissingAlt.push(src || "(no src)");
  }

  // JSON-LD
  const jsonLdRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jl;
  while ((jl = jsonLdRe.exec(html))) {
    data.jsonLdRawCount++;
    const raw = jl[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) data.jsonLd.push(...parsed);
      else if (parsed && typeof parsed === "object" && (parsed as any)["@graph"] && Array.isArray((parsed as any)["@graph"])) {
        data.jsonLd.push(...(parsed as any)["@graph"]);
      } else {
        data.jsonLd.push(parsed);
      }
    } catch {
      // tolerate broken JSON-LD blocks (common on real sites)
    }
  }

  // Pull bylines and dates from JSON-LD
  for (const node of data.jsonLd) {
    if (!node || typeof node !== "object") continue;
    const n: any = node;
    if (typeof n.author === "string") data.bylineCandidates.push(n.author);
    else if (n.author && typeof n.author === "object" && typeof n.author.name === "string") {
      data.bylineCandidates.push(n.author.name);
    } else if (Array.isArray(n.author)) {
      for (const a of n.author) {
        if (typeof a === "string") data.bylineCandidates.push(a);
        else if (a && typeof a.name === "string") data.bylineCandidates.push(a.name);
      }
    }
    if (typeof n.datePublished === "string") data.dateCandidates.push(n.datePublished);
    if (typeof n.dateModified === "string") data.dateCandidates.push(n.dateModified);
  }

  // <time> elements
  const timeMatches = html.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/gi) ?? [];
  for (const t of timeMatches) {
    const dt = t.match(/datetime\s*=\s*["']([^"']+)["']/i);
    if (dt) data.dateCandidates.push(dt[1]);
  }

  // Body text + word count + text-to-code ratio
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const visibleText = stripTags(bodyHtml);
  data.bodyText = visibleText.slice(0, 50_000);
  data.wordCount = visibleText ? visibleText.split(/\s+/).filter(Boolean).length : 0;
  data.textToCodeRatio = bodyHtml.length > 0 ? +(visibleText.length / bodyHtml.length).toFixed(3) : 0;

  // Byline pattern in first ~1KB of visible text
  const head = visibleText.slice(0, 1500);
  const byMatch = head.match(/\bBy\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3})\b/);
  if (byMatch) data.bylineCandidates.push(byMatch[1]);

  // Lists and tables
  data.listCount = (html.match(/<(ul|ol)\b/gi) ?? []).length;
  data.tableCount = (html.match(/<table\b/gi) ?? []).length;

  // Links
  const anchorTags = html.match(/<a\b[^>]*\shref\s*=\s*["'][^"']+["'][^>]*>/gi) ?? [];
  const seenOutbound = new Set<string>();
  for (const tag of anchorTags) {
    const href = attr(tag, "href");
    if (!href) continue;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    const u = safeUrl(href, baseUrl);
    if (!u) continue;
    if (u.host === baseHost) {
      data.internalLinkCount++;
    } else {
      if (!seenOutbound.has(u.host)) {
        seenOutbound.add(u.host);
        data.outboundDomains.push(u.host);
        if (isAuthoritative(u.host)) data.authoritativeOutboundCount++;
      }
    }
  }

  // De-duplicate bylines and dates
  data.bylineCandidates = Array.from(new Set(data.bylineCandidates)).slice(0, 5);
  data.dateCandidates = Array.from(new Set(data.dateCandidates)).slice(0, 5);

  return data;
}
