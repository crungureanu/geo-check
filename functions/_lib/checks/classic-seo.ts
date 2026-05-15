import type { CheckContext, Finding } from "../types";

export function classicSeoChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;

  // Title
  if (!page.title) {
    findings.push({
      id: `seo.no-title:${page.url}`,
      status: "fail",
      severity: "blocking",
      discipline: "classic-seo",
      title: "No <title> tag",
      message: `${page.url} has no <title>. Every page must have one.`,
    });
  } else if (page.title.length < 20) {
    findings.push({
      id: `seo.title-short:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: "<title> is short",
      message:
        `${page.url} title is ${page.title.length} characters ("${page.title}"). Aim for 30-65 characters with a clear value proposition.`,
    });
  } else if (page.title.length > 70) {
    findings.push({
      id: `seo.title-long:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: "<title> is long",
      message:
        `${page.url} title is ${page.title.length} characters. Google truncates around 60-65. Tighten it.`,
    });
  }

  // Meta description
  if (!page.metaDescription) {
    findings.push({
      id: `seo.no-meta-desc:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "classic-seo",
      title: "No meta description",
      message:
        `${page.url} has no <meta name="description">. Add one — it appears in search snippets and is often quoted by AI assistants.`,
      fixSnippet: `<meta name="description" content="A clear, 120-160 character summary of this page." />`,
    });
  } else if (page.metaDescription.length < 70) {
    findings.push({
      id: `seo.meta-desc-short:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: "Meta description is short",
      message:
        `${page.url} meta description is ${page.metaDescription.length} characters. Aim for 120-160.`,
    });
  } else if (page.metaDescription.length > 180) {
    findings.push({
      id: `seo.meta-desc-long:${page.url}`,
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: "Meta description is long",
      message:
        `${page.url} meta description is ${page.metaDescription.length} characters. Google truncates around 160.`,
    });
  }

  // Favicon / apple-touch-icon — only on home
  if (ctx.isHome) {
    if (!page.hasFavicon) {
      findings.push({
        id: "seo.no-favicon",
        status: "warn",
        severity: "nice",
        discipline: "classic-seo",
        title: "No favicon detected",
        message:
          `Add a favicon — it appears in browser tabs, bookmarks, and some AI-answer source cards.`,
        fixSnippet: `<link rel="icon" type="image/png" href="/favicon.png" />`,
      });
    }
    if (!page.hasAppleTouchIcon) {
      findings.push({
        id: "seo.no-apple-touch-icon",
        status: "warn",
        severity: "nice",
        discipline: "classic-seo",
        title: "No apple-touch-icon",
        message:
          `Add an apple-touch-icon for iOS home-screen shortcuts and certain AI-answer surfaces.`,
        fixSnippet: `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />`,
      });
    }
  }

  // Viewport
  if (!page.metaViewport) {
    findings.push({
      id: `seo.no-viewport:${page.url}`,
      status: "warn",
      severity: "important",
      discipline: "classic-seo",
      title: "No mobile viewport meta tag",
      message:
        `${page.url} has no <meta name="viewport">. Mobile rendering will be broken. Add the standard viewport meta.`,
      fixSnippet: `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    });
  }

  // Open Graph
  if (ctx.isHome) {
    const ogMissing: string[] = [];
    if (!page.ogTitle) ogMissing.push("og:title");
    if (!page.ogDescription) ogMissing.push("og:description");
    if (!page.ogImage) ogMissing.push("og:image");
    if (!page.ogType) ogMissing.push("og:type");
    if (ogMissing.length >= 2) {
      findings.push({
        id: "seo.og-missing",
        status: "warn",
        severity: "nice",
        discipline: "both",
        title: `Open Graph tags missing: ${ogMissing.join(", ")}`,
        message:
          `Open Graph tags drive how your site previews on social and in AI source cards. Add the missing tags.`,
        fixSnippet: `<meta property="og:title" content="..." />\n<meta property="og:description" content="..." />\n<meta property="og:image" content="https://..." />\n<meta property="og:type" content="website" />`,
      });
    }
    if (!page.twitterCard) {
      findings.push({
        id: "seo.no-twitter-card",
        status: "warn",
        severity: "nice",
        discipline: "classic-seo",
        title: "No Twitter Card meta tag",
        message: `Add <meta name="twitter:card" content="summary_large_image"> for clean previews on X.`,
      });
    }
  }

  // PageSpeed (Core Web Vitals) — only home
  if (ctx.isHome && page.pagespeed) {
    const ps = page.pagespeed;
    if (ps.fetched && ps.performanceScore !== null && ps.performanceScore < 0.5) {
      findings.push({
        id: "seo.cwv-poor",
        status: "fail",
        severity: "important",
        discipline: "classic-seo",
        title: `Poor performance score: ${Math.round(ps.performanceScore * 100)}/100`,
        message:
          `Google PageSpeed Insights gives the home page ${Math.round(ps.performanceScore * 100)}/100. LCP ${ps.lcp ?? "?"} ms, INP ${ps.inp ?? "?"} ms, CLS ${ps.cls ?? "?"}. Slow pages hurt both classic SEO rankings and AI-crawler success rates.`,
      });
    } else if (ps.fetched && ps.performanceScore !== null && ps.performanceScore < 0.75) {
      findings.push({
        id: "seo.cwv-mediocre",
        status: "warn",
        severity: "nice",
        discipline: "classic-seo",
        title: `Performance score: ${Math.round(ps.performanceScore * 100)}/100`,
        message: `PageSpeed Insights performance is below 75. Focus on LCP and INP improvements.`,
      });
    }
  }

  return findings;
}
