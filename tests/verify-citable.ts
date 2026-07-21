// Citable-passage semantics: gate + curve + span measurement. Guards the
// glassartbylinda.com regression class: (a) a lone incidental question
// heading on a non-Q&A page must NOT fire the weight-25 signal at all;
// (b) h5/h6-as-body-copy themes must not zero the measured answer (span
// runs to the next SAME-OR-HIGHER heading); (c) attainment is a smooth
// curve on the BEST answer, not a 0.2/0.6/1.0 cliff. Pure logic: synthetic
// HTML -> extractPageData -> contentDepthChecks, no network.
// Usage: node --import ./tests/register.mjs tests/verify-citable.ts
import { extractPageData } from "../functions/_lib/extractor.ts";
import { contentDepthChecks } from "../functions/_lib/checks/content-depth.ts";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

function run(bodyHtml: string, pageType = "other"): any | undefined {
  const html = `<html lang="en"><head><title>Fixture</title></head><body><main><p>${words(220, "filler")}</p>${bodyHtml}</main></body></html>`;
  const doc = {
    url: "http://fixture.test/page",
    finalUrl: "http://fixture.test/page",
    status: 200,
    ok: true,
    contentType: "text/html",
    headers: {},
    body: html,
    redirectChain: 0,
  } as any;
  const page = extractPageData(doc);
  const ctx = {
    page,
    pageInfo: { url: page.url, type: pageType, status: 200 },
    rootFiles: {},
    isHome: false,
    now: Date.UTC(2026, 5, 14),
  } as any;
  // Raw (pre-dedupe) per-page ids are `content.citable-passage:<url>`.
  return contentDepthChecks(ctx).find((f: any) => f.id.startsWith("content.citable-passage"));
}

const probs: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) probs.push(`${name}${detail ? `: ${detail}` : ""}`);
};

// (a) Gate: ONE incidental question on a non-Q&A page -> signal not applicable.
{
  const f = run(`<h2>What is widget polishing?</h2><p>${words(10)}</p><h2>Our services</h2><p>${words(30)}</p>`);
  check("gate/lone-question", f === undefined, `expected no finding, got ${f?.status}`);
}
// Gate: the same lone question DOES apply on an article page...
{
  const f = run(`<h2>What is widget polishing?</h2><p>${words(10)}</p>`, "article");
  check("gate/article-applies", f?.status === "warn", `got ${f?.status}`);
}
// ...and with 2+ genuine questions on any page type.
{
  const f = run(`<h2>What is X?</h2><p>${words(140)}</p><h2>How does Y work?</h2><p>${words(140)}</p>`);
  check("gate/two-questions-pass", f?.status === "pass", `got ${f?.status}`);
}
// Gate: FAQPage schema admits a lone question.
{
  const f = run(
    `<script type="application/ld+json">{"@type":"FAQPage"}</script><h2>What is X?</h2><p>${words(140)}</p>`,
  );
  check("gate/faq-schema-applies", f?.status === "pass", `got ${f?.status}`);
}

// (b) Span: h5/h6 "body copy" between the question and the next h2 must
// COUNT toward the answer (the Shopify-theme pathology: was measured 0).
{
  const f = run(
    `<h2>What is hard edge glass art?</h2><h5>${words(70, "alpha")}</h5><h6>${words(70, "beta")}</h6><h2>How is it made?</h2><p>${words(140)}</p>`,
  );
  check("span/h5h6-counted", f?.status === "pass", `got ${f?.status} (h5/h6 text must make the first answer ~140 words)`);
}
// Span: an h3 sub-heading inside an h2 answer no longer cuts it short.
{
  const f = run(
    `<h2>What is X?</h2><p>${words(60)}</p><h3>Details</h3><p>${words(80, "extra")}</p><h2>How does Y work?</h2><p>${words(140)}</p>`,
  );
  check("span/h3-subheading-counted", f?.status === "pass", `got ${f?.status}`);
}

// (c) Curve: graded, not a cliff. 79 words ~0.69 (partial), not 0.2.
{
  const f = run(`<h2>What is X?</h2><p>${words(79)}</p><h2>How does Y work?</h2><p>${words(20)}</p>`);
  check("curve/79-words-partial", f?.status === "partial" && f.attainment > 0.6 && f.attainment < 0.75, `got ${f?.status} att=${f?.attainment}`);
}
// Curve: truly empty answers floor at 0.15 warn (best of two empties).
{
  const f = run(`<h2>What is X?</h2><h2>How does Y work?</h2><p>${words(4)}</p>`);
  check("curve/empty-floor", f?.status === "warn" && f.attainment <= 0.16, `got ${f?.status} att=${f?.attainment}`);
}
// Curve: overlong decays gently (700 words -> 0.6 partial), never below 0.5.
{
  const f = run(`<h2>What is X?</h2><p>${words(700)}</p><h2>How does Y work?</h2><p>${words(4)}</p>`);
  check("curve/overlong-gentle", f?.status === "partial" && f.attainment >= 0.5 && f.attainment < 0.7, `got ${f?.status} att=${f?.attainment}`);
}
// Curve: best section wins - one ideal answer among thin ones scores pass.
{
  const f = run(`<h2>What is X?</h2><p>${words(5)}</p><h2>How does Y work?</h2><p>${words(140)}</p>`);
  check("curve/best-wins", f?.status === "pass", `got ${f?.status}`);
}

if (probs.length === 0) {
  console.log("PASS citable (gate blocks lone questions, h5/h6+h3 spans counted, smooth curve, best section wins)");
  process.exit(0);
} else {
  console.log("FAIL citable");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
