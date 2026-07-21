// Non-HTML exclusion: a sitemap (or platform) can point at data files
// (Shopify's auto-generated /agents.md, feeds, markdown). The scan must
// (a) never select known non-HTML extensions (page-selector
// ASSET_EXTENSIONS), (b) drop extensionless non-HTML responses by
// Content-Type in the B15 reconciliation, surfacing the drop via the
// context.non-html-skipped note, and (c) KEEP failed fetches (null
// contentType) and 200s with no Content-Type header. Pure synthetic
// fixture, no network.
// Usage: node --import ./tests/register.mjs tests/verify-nonhtml.ts
import { performScan } from "../functions/api/scan.ts";
import { installReplayer, HARNESS_NOW } from "./fixture-fetch.ts";

const O = "https://nonhtml-example.com";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width"></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const HTML_CT: [string, string] = ["Content-Type", "text/html; charset=utf-8"];

const fx: Record<string, { status: number; headers: [string, string][]; bodyB64: string }> = {
  [`GET ${O}/robots.txt`]: { status: 200, headers: [["Content-Type", "text/plain"]], bodyB64: b64(`Sitemap: ${O}/sitemap.xml\n`) },
  [`GET ${O}/llms.txt`]: { status: 404, headers: [HTML_CT], bodyB64: b64("not found") },
  [`HEAD ${O}/favicon.ico`]: { status: 200, headers: [["Content-Type", "image/x-icon"]], bodyB64: "" },
  [`GET ${O}/sitemap.xml`]: {
    status: 200,
    headers: [["Content-Type", "application/xml"]],
    bodyB64: b64(
      `<?xml version="1.0"?><urlset><url><loc>${O}/</loc></url><url><loc>${O}/about</loc></url><url><loc>${O}/agents.md</loc></url><url><loc>${O}/notes</loc></url><url><loc>${O}/noct</loc></url><url><loc>${O}/down</loc></url></urlset>`,
    ),
  },
  [`GET ${O}/`]: { status: 200, headers: [HTML_CT], bodyB64: b64(html("Home", "Welcome to the home page with some words about what we do here. ".repeat(5))) },
  [`GET ${O}/about`]: { status: 200, headers: [HTML_CT], bodyB64: b64(html("About", "All about this test company and its long history. ".repeat(5))) },
  // Extensionless markdown: MUST be selected, fetched, then dropped by
  // Content-Type with a note. (An .md URL never even gets selected.)
  [`GET ${O}/notes`]: { status: 200, headers: [["Content-Type", "text/markdown; charset=utf-8"]], bodyB64: b64("# Notes\n\nMarkdown, not a page.") },
  // 200 HTML with NO Content-Type header: MUST be kept (some origins omit it).
  [`GET ${O}/noct`]: { status: 200, headers: [], bodyB64: b64(html("NoCT", "Header-less but real HTML content right here. ".repeat(5))) },
  // Persistent 5xx (also on the resilient retry): null-ish contentType on a
  // NON-2xx must be kept so fetch findings still fire.
  [`GET ${O}/down`]: { status: 503, headers: [HTML_CT], bodyB64: b64("busy") },
};
const replay = installReplayer(fx);

const probs: string[] = [];
let result: any;
try {
  result = await performScan(`${O}/`, {} as any, { now: HARNESS_NOW });
} catch (e: any) {
  console.log(`FAIL: scan threw: ${e?.message ?? e}`);
  process.exit(1);
}

const urls = result.scannedPages.map((p: any) => p.url);

// (a) .md never selected, never fetched
if (urls.some((u: string) => u.includes("agents.md"))) probs.push("/agents.md was scanned");
if (replay.misses().some((k) => k.includes("agents.md"))) probs.push("/agents.md was fetched");

// (b) extensionless markdown dropped + note present
if (urls.some((u: string) => u.endsWith("/notes"))) probs.push("/notes (text/markdown) was scored");
const note = result.findings.find((f: any) => f.id === "context.non-html-skipped");
if (!note) probs.push("missing context.non-html-skipped note");
else {
  if (note.status !== "pass") probs.push(`note status ${note.status} (must be pass => 0 score impact)`);
  if (!note.message.includes("/notes")) probs.push("note does not name the dropped URL");
}

// (c) keep: home, header-less HTML, failed fetch
if (!urls.some((u: string) => u === `${O}/`)) probs.push("home missing");
if (!urls.some((u: string) => u.endsWith("/noct"))) probs.push("/noct (no Content-Type header) was wrongly dropped");
if (!urls.some((u: string) => u.endsWith("/down"))) probs.push("/down (failed fetch) was wrongly dropped");

// No finding may cite the dropped file as an affected page
for (const f of result.findings) {
  for (const ap of f.affectedPages ?? []) {
    if (ap.includes("agents.md") || ap.endsWith("/notes")) probs.push(`finding ${f.id} cites dropped page ${ap}`);
  }
}

if (typeof result.scores.aiSeo !== "number" || result.scores.aiSeo < 1) probs.push(`aiSeo invalid: ${result.scores.aiSeo}`);

if (probs.length === 0) {
  console.log(`PASS non-html (scored ${urls.length} pages, note present, .md never fetched, no-CT + failed kept)`);
  process.exit(0);
} else {
  console.log("FAIL non-html");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
