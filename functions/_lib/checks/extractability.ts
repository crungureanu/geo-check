import type { CheckContext, Finding } from "../types";

export function extractabilityChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  // Raw HTML word count vs visible text
  if (page.wordCount < 100) {
    findings.push({
      id: `extract.thin-content:${page.url}`,
      status: "fail",
      severity: "blocking",
      discipline: "ai-seo",
      title: "Page has very little text in the raw HTML",
      message:
        `${page.url} has only ${page.wordCount} visible words in the raw HTML. AI crawlers do not execute JavaScript, so if your content is rendered client-side they will see almost nothing. Use server-side rendering or pre-rendering.`,
    });
  } else if (page.wordCount < 300) {
    findings.push({
      id: `extract.short-content:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "ai-seo",
      title: "Page is short on body text",
      message:
        `${page.url} has ${page.wordCount} visible words. Pages under 300 words rarely surface in AI answers because there isn't enough context. Expand the page.`,
    });
  }

  // H1
  if (page.h1Count === 0) {
    findings.push({
      id: `extract.no-h1:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "both",
      title: "No <h1> heading on the page",
      message: `${page.url} has no <h1>. Every page should have exactly one h1 that describes the page topic.`,
    });
  }

  // Heading hierarchy (no skipped levels)
  const levels = page.headings.map((h) => h.level);
  let skipped = false;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      skipped = true;
      break;
    }
  }
  if (skipped) {
    findings.push({
      id: `extract.heading-skip:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "Heading hierarchy skips levels",
      message:
        `${page.url} jumps heading levels (e.g. h2 directly to h4). A clean h1→h2→h3 hierarchy helps AI assistants understand structure.`,
    });
  }

  // Semantic landmarks
  if (!page.hasMain && !page.hasArticle) {
    findings.push({
      id: `extract.no-landmark:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "No <main> or <article> landmark",
      message:
        `${page.url} has neither <main> nor <article>. Wrapping the primary content in a semantic landmark helps content extractors identify the body of the page.`,
    });
  }

  // Image alt coverage
  if (page.imgCount >= 5) {
    const coverage = page.imgWithAlt / page.imgCount;
    if (coverage < 0.5) {
      findings.push({
        id: `extract.alt-low:${page.url}`,
        status: "warn",
        severity: "important",
        discipline: "ai-seo",
        title: `Only ${Math.round(coverage * 100)}% of images have alt text`,
        message:
          `${page.imgCount - page.imgWithAlt} out of ${page.imgCount} images on ${page.url} are missing alt text. AI assistants use alt to understand images. Add descriptive alt attributes.`,
        fixSnippet:
          page.imgMissingAlt.length > 0
            ? `Missing alt on (first ${Math.min(page.imgMissingAlt.length, 5)}):\n${page.imgMissingAlt.slice(0, 5).map((s) => `  - ${s}`).join("\n")}`
            : undefined,
      });
    } else if (coverage < 0.9) {
      findings.push({
        id: `extract.alt-partial:${page.url}`,
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        title: `${Math.round(coverage * 100)}% alt-text coverage`,
        message: `${page.imgCount - page.imgWithAlt} of ${page.imgCount} images missing alt. Push coverage above 90%.`,
      });
    }
  }

  // Text-to-code ratio
  if (page.textToCodeRatio < 0.05 && page.wordCount > 0) {
    findings.push({
      id: `extract.thin-text-ratio:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "Very low text-to-code ratio",
      message:
        `${page.url} has a text-to-code ratio of ${(page.textToCodeRatio * 100).toFixed(1)}%. Most of the page is markup/scripts. Consider whether the visible content can be enriched.`,
    });
  }

  return findings;
}
