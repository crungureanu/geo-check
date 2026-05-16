import { fetchDoc } from "./fetcher";
import type { FetchedDoc, PageType } from "./types";

const ASSET_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|tar|gz|mp4|webm|mov|mp3|css|js|xml|txt|json)(\?|$)/i;

export function classifyUrl(url: string): PageType {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return "other";
  }
  if (path === "" || path === "/") return "home";
  if (/^\/(about|about-us|about-me|aboutme|about-the-author|company|our-story|story|who-we-are|who-i-am|meet-the-team|meet|team|bio|biography)(\/|$)/.test(path)) return "about";
  if (/^\/(contact|contact-us|contact-me|get-in-touch|reach-us|book-a-call|book|schedule|hire-me)(\/|$)/.test(path)) return "contact";
  if (/^\/(services?|solutions?|what-we-do|offerings?)(\/|$)/.test(path)) return "service";
  if (/^\/(products?|shop|store|p)(\/|$)/.test(path)) return "product";
  if (/^\/(blog|posts?|news|articles?|insights?|resources?|learn|guides?|stories)(\/|$)/.test(path))
    return "article";
  if (/^\/(faq|faqs|help|support|questions?|knowledge-?base)(\/|$)/.test(path)) return "faq";
  if (/^\/(pricing|plans|packages)(\/|$)/.test(path)) return "pricing";
  if (/^\/(privacy|terms|legal|cookies?|imprint|disclaimer)(\/|$)/.test(path)) return "other";
  if (/^\/(category|categories|tag|tags|archives?|page\/\d+)(\/|$)/.test(path)) return "other";
  return "other";
}

// True when the URL is the listing/index page of a section (e.g. /blog/, /news/),
// not an individual entry inside it (e.g. /blog/my-post/). Used to skip article-
// level rules on index pages where headings are post titles, not Q&A or claims.
export function isSectionIndex(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return false;
  }
  if (path === "" || path === "/") return false;
  return /^\/(blog|posts?|news|articles?|insights?|resources?|learn|guides?|stories|case-studies|portfolio|work|projects?|category|categories|tag|tags|archives?)$/.test(path);
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    out.push(m[1].trim());
    if (out.length > 5000) break; // cap to avoid runaway
  }
  return out;
}

export async function expandSitemap(
  sitemapDoc: FetchedDoc | null,
  origin: string,
): Promise<string[]> {
  if (!sitemapDoc || !sitemapDoc.ok) return [];

  const body = sitemapDoc.body;
  if (/<sitemapindex\b/i.test(body)) {
    const childLocs = extractLocs(body)
      .filter((u) => u.startsWith("http"))
      .slice(0, 3); // cap to 3 child sitemaps
    const childDocs = await Promise.all(
      childLocs.map((u) => fetchDoc(u, { timeoutMs: 6000 })),
    );
    const all: string[] = [];
    for (const d of childDocs) if (d.ok) all.push(...extractLocs(d.body));
    return all.filter((u) => u.startsWith("http"));
  }
  return extractLocs(body).filter((u) => u.startsWith("http"));
}

const PICK_ORDER: PageType[] = [
  "home",
  "service",
  "product",
  "article",
  "about",
  "faq",
  "pricing",
  "contact",
];

export function selectPages(
  allUrls: string[],
  pastedUrl: string,
  origin: string,
  max: number = 10,
): Array<{ url: string; type: PageType }> {
  const sameOrigin = (u: string) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  };

  const cleaned = allUrls
    .filter((u) => sameOrigin(u))
    .filter((u) => !ASSET_EXTENSIONS.test(u));

  const buckets: Record<PageType, string[]> = {
    home: [],
    about: [],
    contact: [],
    service: [],
    product: [],
    article: [],
    faq: [],
    pricing: [],
    other: [],
  };
  for (const u of cleaned) buckets[classifyUrl(u)].push(u);

  // Always start with pasted URL
  const pastedType = classifyUrl(pastedUrl);
  const result: Array<{ url: string; type: PageType }> = [
    { url: pastedUrl, type: pastedType },
  ];
  const seen = new Set<string>([pastedUrl]);

  // Ensure home is included
  if (pastedType !== "home") {
    const homeUrl = buckets.home[0] ?? origin + "/";
    if (!seen.has(homeUrl)) {
      result.push({ url: homeUrl, type: "home" });
      seen.add(homeUrl);
    }
  }

  // Pick one representative from each bucket
  for (const type of PICK_ORDER) {
    if (result.length >= max) break;
    if (type === "home") continue;
    const candidates = buckets[type].filter((u) => !seen.has(u));
    if (candidates.length > 0) {
      result.push({ url: candidates[0], type });
      seen.add(candidates[0]);
    }
  }

  // Fill with extras from product/article/service (depth) before "other"
  for (const type of ["product", "article", "service"] as PageType[]) {
    if (result.length >= max) break;
    for (const u of buckets[type]) {
      if (result.length >= max) break;
      if (!seen.has(u)) {
        result.push({ url: u, type });
        seen.add(u);
      }
    }
  }

  // Last-resort fill from "other"
  for (const u of buckets.other) {
    if (result.length >= max) break;
    if (!seen.has(u)) {
      result.push({ url: u, type: "other" });
      seen.add(u);
    }
  }

  return result.slice(0, max);
}
