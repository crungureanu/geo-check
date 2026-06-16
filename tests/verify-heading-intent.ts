// Heading-intent classification: pure-logic guard for which headings the
// extractor treats as a real Q&A (sections[].question), an ambiguous
// interrogative title (maybeQuestion), or neither (CTA / first-person
// "offer of help"). These drive the bar-3 citable-passage scoring, so a
// regression here silently mis-scores content. The live path is fine to
// test offline because extractPageData is pure (HTML in, data out).
// Usage: node --import ./tests/register.mjs tests/verify-heading-intent.ts
import { extractPageData } from "../functions/_lib/extractor.ts";

// expected: "q" = real question (scored), "maybe" = ambiguous (unscored
// note only), "no" = neither (CTA / help-offer / declarative non-opener).
const CASES: { h: string; expect: "q" | "maybe" | "no" }[] = [
  // First-person "offer of help" CTAs: must NOT be scored as Q&A (the
  // practiceplusgroup.com regression).
  { h: "How can we help?", expect: "no" },
  { h: "How can we help you?", expect: "no" },
  { h: "How may I help you?", expect: "no" },
  { h: "What can we do for you?", expect: "no" },
  { h: "Can we help?", expect: "no" },
  { h: "How can we assist you today?", expect: "no" },
  // Generic CTA headings ending in "?".
  { h: "Ready to get started?", expect: "no" },
  { h: "Want to learn more?", expect: "no" },
  // Genuine informational questions: still scored.
  { h: "How does AI citation work?", expect: "q" },
  { h: "What is generative engine optimisation?", expect: "q" },
  { h: "How much does a scan cost?", expect: "q" },
  // Second-person "you" question (the visitor asking the site): the
  // subject is not first-person, so it stays a real question.
  { h: "How can you index JavaScript pages?", expect: "q" },
  // Interrogative opener, NO "?": ambiguous -> unscored note, never scored.
  { h: "How the audit works", expect: "maybe" },
  { h: "What we do", expect: "maybe" },
  // Plain declarative section title: neither.
  { h: "Our pricing plans", expect: "no" },
];

// Each heading needs a little body so a section is emitted; the body
// length is irrelevant to classification (it only matters at scoring time).
const body = CASES.map(
  (c) => `<h2>${c.h}</h2><p>Some short body text for this section here.</p>`,
).join("\n");
const html = `<html lang="en"><head><title>Heading intent fixture page</title></head><body><main>${body}</main></body></html>`;

const doc = {
  url: "http://fixture.test/",
  finalUrl: "http://fixture.test/",
  status: 200,
  ok: true,
  contentType: "text/html",
  headers: {},
  body: html,
  redirectChain: 0,
} as any;

const data = extractPageData(doc);
const byHeading = new Map(data.sections.map((s) => [s.heading, s]));

const probs: string[] = [];
for (const c of CASES) {
  const s = byHeading.get(c.h);
  if (!s) {
    probs.push(`no section emitted for: "${c.h}"`);
    continue;
  }
  const got: "q" | "maybe" | "no" = s.question ? "q" : s.maybeQuestion ? "maybe" : "no";
  if (got !== c.expect) {
    probs.push(`"${c.h}": expected ${c.expect}, got ${got} (question=${s.question}, maybeQuestion=${s.maybeQuestion})`);
  }
}

// A real question and an ambiguous one are mutually exclusive per heading.
for (const s of data.sections) {
  if (s.question && s.maybeQuestion) probs.push(`"${s.heading}" is both question and maybeQuestion`);
}

if (probs.length === 0) {
  console.log(`PASS heading-intent (${CASES.length} headings: help-offer/CTA excluded, real questions scored, ambiguous titles noted)`);
  process.exit(0);
} else {
  console.log("FAIL heading-intent");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
