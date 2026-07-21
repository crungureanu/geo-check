// Custom page selection: prove resolveCustomPages validation and the
// performScan customPages path. Homepage rule (user decision): 1 chosen
// page scans exactly that page; 2+ chosen pages auto-add the homepage
// (deduped when already listed). Sitemap-listed decoy pages must never
// be fetched (custom mode skips selection AND expansion). Pure
// synthetic fixture, no network.
// Usage: node --import ./tests/register.mjs tests/verify-custom-pages.ts
import { performScan, resolveCustomPages } from "../functions/api/scan.ts";
import { installReplayer, HARNESS_NOW } from "./fixture-fetch.ts";

const O = "https://custom-example.com";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const html = (title: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width"></head><body><main><h1>${title}</h1><p>${`Real content about ${title} for the scanner to read. `.repeat(12)}</p></main></body></html>`;
const HTML_CT: [string, string] = ["Content-Type", "text/html; charset=utf-8"];
const pg = (t: string) => ({ status: 200, headers: [HTML_CT], bodyB64: b64(html(t)) });

const fx: Record<string, { status: number; headers: [string, string][]; bodyB64: string }> = {
  [`GET ${O}/robots.txt`]: { status: 200, headers: [["Content-Type", "text/plain"]], bodyB64: b64(`Sitemap: ${O}/sitemap.xml\n`) },
  [`GET ${O}/llms.txt`]: { status: 404, headers: [HTML_CT], bodyB64: b64("nope") },
  [`HEAD ${O}/favicon.ico`]: { status: 200, headers: [["Content-Type", "image/x-icon"]], bodyB64: "" },
  // Sitemap lists decoys; in custom mode they must never be fetched
  // (they are absent from the fixture, so a fetch would surface as a
  // replay miss and a status-599 page).
  [`GET ${O}/sitemap.xml`]: {
    status: 200,
    headers: [["Content-Type", "application/xml"]],
    bodyB64: b64(`<?xml version="1.0"?><urlset><url><loc>${O}/decoy-a</loc></url><url><loc>${O}/decoy-b</loc></url></urlset>`),
  },
  [`GET ${O}/`]: pg("Home"),
  [`GET ${O}/pricing`]: pg("Pricing"),
  [`GET ${O}/contact`]: pg("Contact"),
  [`GET ${O}/blog/how-to-widget`]: pg("How to widget"),
};

const probs: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) probs.push(`${name}${detail ? `: ${detail}` : ""}`);
};

// ---- resolveCustomPages unit cases ----
{
  const origin = new URL(`${O}/`);
  const r1 = resolveCustomPages(origin, ["/pricing", "https://www.custom-example.com/contact"]);
  check("resolve/path+www", "urls" in r1 && r1.urls.length === 2 && r1.urls[0] === `${O}/pricing`, JSON.stringify(r1));
  const r2 = resolveCustomPages(origin, ["https://other-site.com/page"]);
  check("resolve/off-site", "error" in r2 && r2.error.includes("different website"), JSON.stringify(r2));
  const r3 = resolveCustomPages(origin, Array.from({ length: 11 }, (_, i) => `/p${i}`));
  check("resolve/max-10", "error" in r3, JSON.stringify(r3));
  const r4 = resolveCustomPages(origin, ["/pricing", `${O}/pricing/`]);
  check("resolve/dedupe", "urls" in r4 && r4.urls.length === 1, JSON.stringify(r4));
  const r5 = resolveCustomPages(origin, []);
  check("resolve/empty", "error" in r5, JSON.stringify(r5));
  const r6 = resolveCustomPages(origin, ["not a url at all %%%"]);
  check("resolve/invalid", "error" in r6, JSON.stringify(r6));
}

async function scan(paths: string[]) {
  const resolved = resolveCustomPages(new URL(`${O}/`), paths);
  if ("error" in resolved) throw new Error(`resolve failed: ${resolved.error}`);
  const replay = installReplayer(fx);
  const result = await performScan(`${O}/`, {} as any, { now: HARNESS_NOW, customPages: resolved.urls });
  return { result, misses: replay.misses() };
}

// ---- 3 chosen pages: homepage auto-added ----
{
  const { result, misses } = await scan(["/pricing", "/blog/how-to-widget", "/contact"]);
  const urls = result.scannedPages.map((p: any) => p.url);
  check("multi/count", urls.length === 4, `got ${urls.length}: ${urls.join(", ")}`);
  check("multi/home-added", urls.includes(`${O}/`), urls.join(", "));
  check("multi/marker", (result as any).pageSelection === "custom");
  const home = result.scannedPages.find((p: any) => p.type === "home");
  check("multi/home-not-chosen", home && !(home as any).chosen);
  check("multi/others-chosen", result.scannedPages.filter((p: any) => (p as any).chosen).length === 3);
  const note = result.findings.find((f: any) => f.id === "context.custom-pages");
  check("multi/note", Boolean(note), "missing context.custom-pages");
  check("multi/note-mentions-home", Boolean(note && note.message.includes("added automatically")));
  check("multi/no-decoys", !urls.some((u: string) => u.includes("decoy")) && misses.length === 0, `misses: ${misses.join(", ")}`);
}

// ---- 1 chosen page: exactly that page, no homepage ----
{
  const { result } = await scan(["/blog/how-to-widget"]);
  const urls = result.scannedPages.map((p: any) => p.url);
  check("single/count", urls.length === 1, urls.join(", "));
  check("single/no-home", !urls.includes(`${O}/`), urls.join(", "));
  check("single/chosen", (result.scannedPages[0] as any).chosen === true);
  check("single/score", typeof result.scores.aiSeo === "number" && result.scores.aiSeo >= 1);
  const note = result.findings.find((f: any) => f.id === "context.custom-pages");
  check("single/note-no-home-claim", Boolean(note && !note.message.includes("added automatically")));
}

// ---- home included in the list: no duplicate ----
{
  const { result } = await scan(["/", "/pricing"]);
  const urls = result.scannedPages.map((p: any) => p.url);
  check("homelisted/count", urls.length === 2, urls.join(", "));
  check("homelisted/all-chosen", result.scannedPages.every((p: any) => (p as any).chosen === true));
}

if (probs.length === 0) {
  console.log("PASS custom-pages (resolve validation, home rule 1 vs 2+, dedupe, decoys never fetched)");
  process.exit(0);
} else {
  console.log("FAIL custom-pages");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
