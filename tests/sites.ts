// Regression-sensitive site set. Each exercises a behaviour a past bug
// touched, so a frozen golden here guards every fix shipped this cycle.
//
// mode "strict": result must be byte-identical to the golden (proves a
//   refactor changed nothing). Requires the site to be deterministic.
// mode "invariant": the site's sitemap is server-side nondeterministic
//   (B15-4: semrush serves a different sitemap per request, so page
//   selection legitimately varies run to run). Byte-golden is
//   impossible until B15-4 lands; instead assert the properties the
//   B15 / B15-2 / B16 fixes guarantee. Upgrades to "strict" once
//   deterministic selection (task #4) ships.
export const SITES: {
  slug: string;
  url: string;
  mode: "strict" | "invariant";
  why: string;
}[] = [
  { slug: "selectcarleasing", url: "https://www.selectcarleasing.co.uk", mode: "strict", why: "B16 Accept-header false 404; sitemap; redirects" },
  { slug: "seranking", url: "https://seranking.com", mode: "strict", why: "B15 same-origin many-to-one dedupe; .html slugs (B15-3)" },
  { slug: "example", url: "https://example.com", mode: "strict", why: "trivial single page; no-sitemap fallback path" },
  { slug: "semrush", url: "https://www.semrush.com", mode: "invariant", why: "B15 cross-host leak + B15-2; sitemap is nondeterministic (B15-4)" },
];
