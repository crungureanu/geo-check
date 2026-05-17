import type { FetchedDoc, PageData } from "./types";

const AUTHORITATIVE_TLDS = [
  ".gov", ".edu", ".ac.uk", ".ac.jp", ".gouv.fr", ".gov.uk",
];
// Recognised high-authority reference domains. Not exhaustive by design:
// the citability check treats "outbound links exist but none on this list"
// as unverified (no penalty), not as "no sources". Bare host match plus a
// www. tolerance is applied in isAuthoritative().
const AUTHORITATIVE_HOSTS = new Set([
  // Reference / standards
  "wikipedia.org",
  "schema.org",
  "w3.org",
  "developer.mozilla.org",
  "stackoverflow.com",
  "github.com",
  // Health / science
  "who.int",
  "nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "arxiv.org",
  "nature.com",
  "sciencedirect.com",
  "scholar.google.com",
  "doi.org",
  // Major news / business press
  "bbc.co.uk",
  "bbc.com",
  "reuters.com",
  "apnews.com",
  "ap.org",
  "nytimes.com",
  "wsj.com",
  "ft.com",
  "economist.com",
  "bloomberg.com",
  "theguardian.com",
  "forbes.com",
  "businessinsider.com",
  "cnbc.com",
  "wired.com",
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "venturebeat.com",
  // Research / analyst firms
  "gartner.com",
  "idc.com",
  "forrester.com",
  "mckinsey.com",
  "bcg.com",
  "bain.com",
  "deloitte.com",
  "pwc.com",
  "kpmg.com",
  "accenture.com",
  "hbr.org",
  "statista.com",
  "pewresearch.org",
  "ourworldindata.org",
  "mit.edu",
  "technologyreview.com",
  "stratechery.com",
  // Official tech / vendor docs
  "web.dev",
  "developers.google.com",
  "developer.apple.com",
  "learn.microsoft.com",
  "docs.aws.amazon.com",
  "cloud.google.com",
  "openai.com",
  "anthropic.com",
  "platform.openai.com",
  "docs.anthropic.com",
]);

const QUESTION_STARTERS =
  /^(what|how|why|when|where|who|which|can|does|do|is|are|will|would|should|could|did|has|have)\b/i;

// Call-to-action headings that end with "?" but are not FAQ questions
// ("Ready to get started?", "Want to learn more?"). Excluded from the strict
// FAQ count so a CTA block doesn't get mistaken for a Q&A section.
const CTA_HEADING =
  /^(ready|want|wanna|looking|interested|need help|got (a )?questions?|have (a )?questions?|got a minute|let'?s|why wait|still|not sure)\b/i;

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
  const h = host.toLowerCase().replace(/^www\./, "");
  if (AUTHORITATIVE_HOSTS.has(h)) return true;
  // Subdomain match: blogs.gartner.com → gartner.com, en.wikipedia.org → wikipedia.org
  for (const base of AUTHORITATIVE_HOSTS) {
    if (h === base || h.endsWith(`.${base}`)) return true;
  }
  return AUTHORITATIVE_TLDS.some((tld) => h.endsWith(tld));
}

function emptyData(doc: FetchedDoc): PageData {
  return {
    url: doc.url,
    finalUrl: doc.finalUrl,
    status: doc.status,
    fetchError: doc.fetchError,
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
    faqHeadings: 0,
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
    // name-keyed tags (mutually exclusive, chain is fine)
    if (name === "description") data.metaDescription = decodeEntities(content);
    else if (name === "robots") data.metaRobots = content;
    else if (name === "author") {
      data.metaAuthor = decodeEntities(content);
      data.bylineCandidates.push(decodeEntities(content));
    } else if (name === "viewport") data.metaViewport = content;

    // OG / twitter / article evaluated independently of the name chain. A
    // single tag commonly carries BOTH name="description" and
    // property="og:description" (e.g. gov.uk); the old else-if short-circuited
    // on name and never set ogDescription (B7). Accept either attribute form
    // (B2: some CMSs emit name="og:*" / name="twitter:card").
    if (property === "og:title" || name === "og:title") data.ogTitle = decodeEntities(content);
    if (property === "og:description" || name === "og:description") data.ogDescription = decodeEntities(content);
    if (property === "og:image" || name === "og:image") data.ogImage = content;
    if (property === "og:type" || name === "og:type") data.ogType = content;
    if (name === "twitter:card" || property === "twitter:card") data.twitterCard = content;
    if (property === "article:published_time" || name === "article:published_time")
      data.dateCandidates.push(content);
    if (property === "article:modified_time" || name === "article:modified_time")
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

  // Headings — collected in document order (single pass). The previous
  // per-level loop assembled the array level-major (all h1s, then all h2s,
  // ...), so extract.heading-skip only ever fired when a level was wholly
  // absent and missed real in-document jumps like h2 -> h4. (B6)
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hm;
  while ((hm = headingRe.exec(html))) {
    const level = Number(hm[1][1]);
    const text = decodeEntities(stripTags(hm[2])).trim();
    if (!text) continue;
    data.headings.push({ level, text });
    if (level === 1) data.h1Count++;
    if (level >= 2 && level <= 3) {
      // Loose: starts with an interrogative OR ends with "?". Used only for
      // the gentle "consider phrasing headings as questions" suggestion.
      if (QUESTION_STARTERS.test(text) || text.endsWith("?")) data.qaHeadings++;
      // Strict: a genuine FAQ question is written as a question (ends with
      // "?") and is not a CTA. Used for the FAQ-schema recommendation, which
      // must not fire on prose with interrogative-worded section titles.
      if (text.endsWith("?") && !CTA_HEADING.test(text)) data.faqHeadings++;
    }
  }

  // Semantic landmarks
  data.hasArticle = /<article\b/i.test(html);
  data.hasMain = /<main\b/i.test(html);

  // Microdata / RDFa
  data.hasMicrodata = /\bitemscope\b/i.test(html) && /\bitemtype\s*=/i.test(html);
  // typeof= is the load-bearing RDFa attribute. Bare property= matched every
  // OpenGraph tag, so any page with OG meta + the string "schema.org" (common
  // in a JSON-LD @context) was falsely flagged as RDFa, which suppressed the
  // legitimate schema.none finding (B5).
  data.hasRdfa = /\btypeof\s*=/i.test(html) && /schema\.org/i.test(html);

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
    // Recursively expand @graph at any depth so array-of-graphs and single
    // object-with-@graph both surface their members (B3). Without this a
    // top-level array whose elements carry @graph kept the wrapper and the
    // Organization/Article @type inside was never seen.
    const pushNode = (node: any): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray((node as any)["@graph"])) {
        for (const g of (node as any)["@graph"]) pushNode(g);
        return;
      }
      data.jsonLd.push(node);
    };
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Real sites ship JSON-LD with trailing commas, stray HTML entities, or
      // two concatenated objects. Rather than drop the whole block silently,
      // try a couple of cheap repairs before giving up (B3, audit-missed #3).
      try {
        const repaired = decodeEntities(raw).replace(/,\s*([}\]])/g, "$1");
        parsed = JSON.parse(repaired);
      } catch {
        continue; // genuinely unparseable: tolerate, skip this block
      }
    }
    if (Array.isArray(parsed)) parsed.forEach(pushNode);
    else pushNode(parsed);
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
  // Measure markup bloat, not inline-payload size. Counting raw <script>/RSC
  // bytes in the denominator made content-rich framework pages (a 7k-word
  // Verge article) falsely trip the low-ratio nice finding (M1).
  const bodyNoScript = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "");
  data.textToCodeRatio = bodyNoScript.length > 0
    ? +(visibleText.length / bodyNoScript.length).toFixed(3)
    : 0;

  // Byline pattern in first ~1KB of visible text
  const head = visibleText.slice(0, 1500);
  const byMatch = head.match(/\bBy\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3})\b/);
  if (byMatch) data.bylineCandidates.push(byMatch[1]);

  // Lower-FP machine-readable byline signals (B11). A bare <span>Name</span>
  // next to the title is deliberately NOT grabbed: a proximity-to-h1 name
  // grab captures dates, "5 min read", category tags, and product names,
  // which would silently suppress the legitimate cite.no-author warning. We
  // only trust explicit markup, and each candidate is gated to 2-5
  // capitalised words so container text is not swept in.
  const isPersonName = (s: string): boolean =>
    /^[A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){1,4}$/.test(s.trim());
  // <a rel="author">Name</a> (only <link rel="author"> was read before)
  const relAuthorRe = /<a\b[^>]*\brel\s*=\s*["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let ra;
  while ((ra = relAuthorRe.exec(html))) {
    const name = decodeEntities(stripTags(ra[1])).trim();
    if (isPersonName(name)) data.bylineCandidates.push(name);
  }
  // itemprop/property="author" element text
  const itempropAuthorRe =
    /<(\w+)\b[^>]*\b(?:itemprop|property)\s*=\s*["'](?:[^"']*\s)?author(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let ip;
  while ((ip = itempropAuthorRe.exec(html))) {
    const name = decodeEntities(stripTags(ip[2])).trim();
    if (isPersonName(name)) data.bylineCandidates.push(name);
  }
  // class-based byline container, hard-gated on a person-name shape
  const classBylineRe =
    /<(\w+)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:author|byline|by-line|writtenby)\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let cb;
  while ((cb = classBylineRe.exec(html))) {
    const txt = decodeEntities(stripTags(cb[2])).trim().replace(/^by\s+/i, "");
    if (isPersonName(txt)) data.bylineCandidates.push(txt);
  }

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
