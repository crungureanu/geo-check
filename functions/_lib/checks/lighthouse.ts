import type { Discipline, Finding, PageSpeedMetrics } from "../types";
import { note } from "./_signal";

// Wave 2a: Lighthouse SEO + Best-Practices audits mined from the PageSpeed
// response. Deliberately narrow. The headline "~27 Lighthouse audits" idea was
// trimmed to the audits that (a) are NOT already covered by a native XEOScan
// signal and (b) need a real headless browser our static fetch cannot
// reproduce. Everything we rejected (duplicates, pass-by-default,
// fail-for-everyone) is documented in reports/signal-catalog.md.
//
// These ship as weight-0 informational NOTES: shown in the report and counted
// as checks we run, but they never move a score. Once their pass/fail
// distribution is calibrated against the golden fixtures, the discriminating
// ones graduate to scored signals in a separate deploy. `charset` stays a note
// permanently (it fails too rarely to discriminate, but matters on the rare
// miss because mis-decoded text is unreadable to both crawlers and AI).

interface MinedAuditDef {
  id: string; // Lighthouse audit id, as keyed in lighthouseResult.audits
  discipline: Discipline;
  passTitle: string;
  failTitle: string;
  pass: string;
  fail: string;
}

export const LIGHTHOUSE_MINED: MinedAuditDef[] = [
  {
    id: "crawlable-anchors",
    discipline: "both",
    passTitle: "Links are crawlable",
    failTitle: "Some links are not crawlable",
    pass: "Every link on the page uses a real href, so crawlers and AI can follow them.",
    fail: "One or more links rely on JavaScript instead of a real href. AI crawlers and search bots do not run JavaScript, so they cannot follow these links to the pages behind them.",
  },
  {
    id: "errors-in-console",
    discipline: "classic-seo",
    passTitle: "No console errors on load",
    failTitle: "JavaScript errors on load",
    pass: "The page loaded without logging any browser errors.",
    fail: "The page logged JavaScript errors when it loaded. Errors can stop content or navigation from rendering for a crawler.",
  },
  {
    id: "deprecations",
    discipline: "classic-seo",
    passTitle: "No deprecated web APIs",
    failTitle: "Uses deprecated web APIs",
    pass: "The page avoids web platform features browsers have deprecated.",
    fail: "The page uses web platform features that browsers have deprecated. These can stop working in a future browser version.",
  },
  {
    id: "inspector-issues",
    discipline: "classic-seo",
    passTitle: "No browser issues flagged",
    failTitle: "Browser flagged page issues",
    pass: "Chrome's issues panel found nothing to flag on this page.",
    fail: "Chrome's issues panel flagged problems on this page (for example cookie, markup, or security issues).",
  },
  {
    id: "link-text",
    discipline: "both",
    passTitle: "Links use descriptive text",
    failTitle: "Some links use generic text",
    pass: "Links use descriptive text that explains where they go.",
    fail: 'Some links use non-descriptive text such as "click here" or "read more". Descriptive link text helps both search engines and AI understand what a link points to.',
  },
  {
    id: "charset",
    discipline: "both",
    passTitle: "Character encoding declared",
    failTitle: "Character encoding missing",
    pass: "The page declares its character encoding early in the HTML.",
    fail: "The page does not declare its character encoding early in the HTML. Without it a crawler can mis-read the text, which garbles the content for both search engines and AI answer engines.",
  },
];

// Audit ids the fetcher should pull out of the PageSpeed response. Kept here so
// the keep-list lives in exactly one place.
export const MINED_AUDIT_IDS: string[] = LIGHTHOUSE_MINED.map((a) => a.id);

// Turn mined PageSpeed audits into weight-0 informational notes. Only emits a
// note for an audit PageSpeed actually scored (0 or 1); an audit it marked
// not-applicable or informative (score null) is skipped so it does not even
// show as a check.
export function lighthouseNotes(ps: PageSpeedMetrics | null | undefined): Finding[] {
  if (!ps || !ps.fetched || !ps.audits) return [];
  const out: Finding[] = [];
  for (const def of LIGHTHOUSE_MINED) {
    const a = ps.audits[def.id];
    if (!a || a.score === null) continue;
    const passed = a.score >= 0.9; // these audits are binary (0 or 1)
    out.push(
      note(`lh.${def.id}`, {
        status: passed ? "pass" : "fail",
        severity: "nice",
        discipline: def.discipline,
        title: passed ? def.passTitle : def.failTitle,
        message: passed
          ? def.pass
          : `${def.fail}${a.displayValue ? ` (${a.displayValue})` : ""}`,
      }),
    );
  }
  return out;
}
