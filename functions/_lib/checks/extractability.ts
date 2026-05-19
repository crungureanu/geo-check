import type { CheckContext, Finding } from "../types";
import { sig } from "./_signal";

// Transactional / utility pages whose job is not to surface in AI answers.
// Word-count rules don't apply: extract.content is NOT APPLICABLE for them
// (emit nothing) rather than scored as a miss.
const UTILITY_PAGE_TYPES = new Set(["contact", "pricing", "transactional", "boilerplate"]);

export function extractabilityChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;
  const u = page.finalUrl;
  const pageType = ctx.pageInfo.type;
  const isUtility = UTILITY_PAGE_TYPES.has(pageType);

  // Content depth, banded. Skipped (not applicable) for utility pages.
  if (!isUtility) {
    const wc = page.wordCount;
    if (wc < 100) {
      const looksClientRendered = page.rawBytes > 30_000 && wc < 100;
      findings.push(
        sig("extract.content", {
          status: "fail",
          severity: "blocking",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "Page has very little text in the raw HTML",
          message: looksClientRendered
            ? `${page.url} has only ${wc} visible words in the raw HTML. AI crawlers do not execute JavaScript, so client-side-rendered content is invisible to them. Use server-side rendering or pre-rendering.`
            : `${page.url} has only ${wc} visible words in the raw HTML. There is not enough text for AI assistants to extract or cite. Add substantive content to the page.`,
        }),
      );
    } else if (wc < 300) {
      findings.push(
        sig("extract.content", {
          status: "warn",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "Page is short on body text",
          message: `${page.url} has ${wc} visible words. Pages under 300 words rarely surface in AI answers because there isn't enough context. If you want this page to be quoted, expand it. If it's a navigational or transactional page, ignore.`,
        }),
      );
    } else if (wc < 600) {
      findings.push(
        sig("extract.content", {
          status: "partial",
          severity: "important",
          discipline: "ai-seo",
          attainment: 0.4,
          pageUrl: u,
          title: "Page body is thin",
          message: `${page.url} has ${wc} visible words. It clears the bare minimum, but 600+ words of substantive, specific content is far more reliably cited by AI assistants. Expand it with detail a reader (and an AI) would actually quote.`,
        }),
      );
    } else if (wc < 1000) {
      findings.push(
        sig("extract.content", {
          status: "partial",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0.7,
          pageUrl: u,
          title: "Page body is moderate",
          message: `${page.url} has ${wc} visible words. Solid, but the most-cited pages tend to run 1000+ words of focused content. Optional polish.`,
        }),
      );
    } else {
      findings.push(
        sig("extract.content", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Enough body text to cite",
          message: `${page.url} has ${wc} visible words in the raw HTML.`,
        }),
      );
    }
  }

  // H1
  findings.push(
    page.h1Count === 0
      ? sig("extract.h1", {
          status: "warn",
          severity: "important",
          discipline: "both",
          attainment: 0,
          pageUrl: u,
          title: "No <h1> heading on the page",
          message: `${page.url} has no <h1>. Every page should have exactly one h1 that describes the page topic.`,
        })
      : sig("extract.h1", {
          status: "pass",
          severity: "important",
          discipline: "both",
          attainment: 1,
          pageUrl: u,
          title: "Has an <h1>",
          message: `${page.url} has an <h1> heading.`,
        }),
  );

  // Heading hierarchy (no skipped levels)
  const levels = page.headings.map((h) => h.level);
  let skipped = false;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      skipped = true;
      break;
    }
  }
  findings.push(
    skipped
      ? sig("extract.heading-hierarchy", {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "Heading hierarchy skips levels",
          message: `${page.url} jumps heading levels (e.g. h2 directly to h4). A clean h1 -> h2 -> h3 hierarchy helps AI assistants understand structure.`,
        })
      : sig("extract.heading-hierarchy", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Clean heading hierarchy",
          message: `${page.url} does not skip heading levels.`,
        }),
  );

  // Semantic landmarks
  findings.push(
    !page.hasMain && !page.hasArticle
      ? sig("extract.landmark", {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 0,
          pageUrl: u,
          title: "No <main> or <article> landmark",
          message: `${page.url} has neither <main> nor <article>. <header>, <nav>, and <section> are navigational or generic, not content landmarks. Wrap the primary content specifically in <main> (or <article> for a standalone piece) so content extractors can isolate the body from chrome.`,
        })
      : sig("extract.landmark", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: 1,
          pageUrl: u,
          title: "Content landmark present",
          message: `${page.url} wraps its content in <main> or <article>.`,
        }),
  );

  // Image alt coverage. Only APPLIES when there are enough images to judge
  // (>=5); a near-imageless page is not graded on alt text (emit nothing).
  if (page.imgCount >= 5) {
    const coverage = page.imgWithAlt / page.imgCount;
    if (coverage >= 0.9) {
      findings.push(
        sig("extract.image-alt", {
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          attainment: coverage,
          pageUrl: u,
          title: `${Math.round(coverage * 100)}% image alt-text coverage`,
          message: `${page.imgWithAlt} of ${page.imgCount} images on ${page.url} have alt text.`,
        }),
      );
    } else {
      findings.push(
        sig("extract.image-alt", {
          status: coverage < 0.5 ? "warn" : "partial",
          severity: coverage < 0.5 ? "important" : "nice",
          discipline: "ai-seo",
          attainment: coverage,
          pageUrl: u,
          title: `Only ${Math.round(coverage * 100)}% of images have alt text`,
          message: `${page.imgCount - page.imgWithAlt} out of ${page.imgCount} images on ${page.url} are missing alt text. AI assistants use alt to understand images. Add descriptive alt attributes.`,
          fixSnippet:
            page.imgMissingAlt.length > 0
              ? `Missing alt on (first ${Math.min(page.imgMissingAlt.length, 5)}):\n${page.imgMissingAlt.slice(0, 5).map((s) => `  - ${s}`).join("\n")}`
              : undefined,
        }),
      );
    }
  }

  // Text-to-code ratio
  if (page.textToCodeRatio < 0.05 && page.wordCount > 0 && page.wordCount < 800) {
    findings.push(
      sig("extract.text-ratio", {
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        attainment: 0,
        pageUrl: u,
        title: "Very low text-to-code ratio",
        message: `${page.url} has a text-to-code ratio of ${(page.textToCodeRatio * 100).toFixed(1)}%. Most of the page is markup/scripts. Consider whether the visible content can be enriched.`,
      }),
    );
  } else {
    findings.push(
      sig("extract.text-ratio", {
        status: "pass",
        severity: "nice",
        discipline: "ai-seo",
        attainment: 1,
        pageUrl: u,
        title: "Reasonable text-to-code ratio",
        message: `${page.url} has a healthy ratio of visible text to markup.`,
      }),
    );
  }

  return findings;
}
