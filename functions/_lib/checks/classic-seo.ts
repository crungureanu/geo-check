import type { CheckContext, Finding, PageSpeedMetrics } from "../types";
import { sig } from "./_signal";

export function classicSeoChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const page = ctx.page;
  const u = page.finalUrl;

  // Title (per page)
  if (!page.title) {
    findings.push(
      sig("seo.title", {
        status: "fail",
        severity: "blocking",
        discipline: "classic-seo",
        attainment: 0,
        pageUrl: u,
        title: "No <title> tag",
        message: `${page.url} has no <title>. Every page must have one.`,
      }),
    );
  } else if (page.title.length < 20 || page.title.length > 70) {
    const longShort = page.title.length < 20 ? "short" : "long";
    findings.push(
      sig("seo.title", {
        status: "partial",
        severity: "nice",
        discipline: "classic-seo",
        attainment: 0.6,
        pageUrl: u,
        title: `<title> is ${longShort}`,
        message:
          longShort === "short"
            ? `${page.url} title is ${page.title.length} characters ("${page.title}"). Aim for 30-65 characters with a clear value proposition.`
            : `${page.url} title is ${page.title.length} characters. Google truncates around 60-65. Tighten it.`,
      }),
    );
  } else {
    findings.push(
      sig("seo.title", {
        status: "pass",
        severity: "nice",
        discipline: "classic-seo",
        attainment: 1,
        pageUrl: u,
        title: "Title tag is well-formed",
        message: `${page.url} has a ${page.title.length}-character title.`,
      }),
    );
  }

  // Meta description (per page)
  if (!page.metaDescription) {
    findings.push(
      sig("seo.meta-desc", {
        status: "warn",
        severity: "important",
        discipline: "classic-seo",
        attainment: 0,
        pageUrl: u,
        title: "No meta description",
        message: `${page.url} has no <meta name="description">. Add one: it appears in search snippets and is often quoted by AI assistants.`,
        fixSnippet: `<meta name="description" content="A clear, 120-160 character summary of this page." />`,
      }),
    );
  } else if (page.metaDescription.length < 70 || page.metaDescription.length > 180) {
    const longShort = page.metaDescription.length < 70 ? "short" : "long";
    findings.push(
      sig("seo.meta-desc", {
        status: "partial",
        severity: "nice",
        discipline: "classic-seo",
        attainment: 0.7,
        pageUrl: u,
        title: `Meta description is ${longShort}`,
        message: `${page.url} meta description is ${page.metaDescription.length} characters. Aim for 120-160.`,
      }),
    );
  } else {
    findings.push(
      sig("seo.meta-desc", {
        status: "pass",
        severity: "nice",
        discipline: "classic-seo",
        attainment: 1,
        pageUrl: u,
        title: "Meta description is well-formed",
        message: `${page.url} has a ${page.metaDescription.length}-character meta description.`,
      }),
    );
  }

  // Viewport (per page)
  findings.push(
    !page.metaViewport
      ? sig("seo.viewport", {
          status: "warn",
          severity: "important",
          discipline: "classic-seo",
          attainment: 0,
          pageUrl: u,
          title: "No mobile viewport meta tag",
          message: `${page.url} has no <meta name="viewport">. Mobile rendering will be broken. Add the standard viewport meta.`,
          fixSnippet: `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
        })
      : sig("seo.viewport", {
          status: "pass",
          severity: "important",
          discipline: "classic-seo",
          attainment: 1,
          pageUrl: u,
          title: "Mobile viewport set",
          message: `${page.url} declares a mobile viewport.`,
        }),
  );

  // Favicon / apple-touch-icon / OG / Twitter: home only.
  if (ctx.isHome) {
    findings.push(
      !page.hasFavicon && !ctx.rootFiles.faviconIcoReachable
        ? sig("seo.favicon", {
            status: "warn",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 0,
            title: "No favicon detected",
            message: `Add a favicon: it appears in browser tabs, bookmarks, and some AI-answer source cards.`,
            fixSnippet: `<link rel="icon" type="image/png" href="/favicon.png" />`,
          })
        : sig("seo.favicon", {
            status: "pass",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 1,
            title: "Favicon present",
            message: `A favicon is reachable.`,
          }),
    );
    findings.push(
      !page.hasAppleTouchIcon
        ? sig("seo.apple-touch-icon", {
            status: "warn",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 0,
            title: "No apple-touch-icon",
            message: `Add an apple-touch-icon for iOS home-screen shortcuts and certain AI-answer surfaces.`,
            fixSnippet: `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />`,
          })
        : sig("seo.apple-touch-icon", {
            status: "pass",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 1,
            title: "Apple touch icon present",
            message: `An apple-touch-icon is declared.`,
          }),
    );

    const ogMissing: string[] = [];
    if (!page.ogTitle) ogMissing.push("og:title");
    if (!page.ogDescription) ogMissing.push("og:description");
    if (!page.ogImage) ogMissing.push("og:image");
    if (!page.ogType) ogMissing.push("og:type");
    findings.push(
      ogMissing.length >= 2
        ? sig("seo.open-graph", {
            status: "warn",
            severity: "nice",
            discipline: "both",
            attainment: 0,
            title: `Open Graph tags missing: ${ogMissing.join(", ")}`,
            message: `Open Graph tags drive how your site previews on social and in AI source cards. Add the missing tags.`,
            fixSnippet: `<meta property="og:title" content="..." />\n<meta property="og:description" content="..." />\n<meta property="og:image" content="https://..." />\n<meta property="og:type" content="website" />`,
          })
        : sig("seo.open-graph", {
            status: "pass",
            severity: "nice",
            discipline: "both",
            attainment: 1,
            title: "Open Graph tags present",
            message: `The home page declares the core Open Graph tags.`,
          }),
    );
    findings.push(
      !page.twitterCard
        ? sig("seo.twitter-card", {
            status: "warn",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 0,
            title: "No Twitter Card meta tag",
            message: `Add <meta name="twitter:card" content="summary_large_image"> for clean previews on X.`,
          })
        : sig("seo.twitter-card", {
            status: "pass",
            severity: "nice",
            discipline: "classic-seo",
            attainment: 1,
            title: "Twitter Card present",
            message: `The home page declares a Twitter Card.`,
          }),
    );
  }

  // Core Web Vitals: only APPLIES when PageSpeed ran. PageSpeed is now
  // opt-in (phase-2 /api/speed), so a default scan and the offline harness
  // never run it and seo.cwv stays not-applicable (goldens unaffected).
  if (ctx.isHome && page.pagespeed && page.pagespeed.fetched && page.pagespeed.performanceScore !== null) {
    const f = cwvFinding(page.pagespeed);
    if (f) findings.push(f);
  }

  return findings;
}

// Built from a PageSpeed result. Exported so the phase-2 /api/speed endpoint
// produces the identical seo.cwv finding it would have produced inline.
// Returns null if the metrics are unusable.
export function cwvFinding(ps: PageSpeedMetrics): Finding | null {
  if (!ps || !ps.fetched || ps.performanceScore === null) return null;
  const score = Math.round((ps.performanceScore as number) * 100);
  const lcp = ps.lcp === null ? "n/a" : `${(ps.lcp / 1000).toFixed(2)} s`;
  const inp = ps.inp === null ? "n/a" : `${Math.round(ps.inp)} ms`;
  const cls = ps.cls === null ? "n/a" : ps.cls.toFixed(3);
  const vitals = `LCP ${lcp} · INP ${inp} · CLS ${cls}`;
  if (score < 50) {
    return sig("seo.cwv", {
      status: "fail",
      severity: "important",
      discipline: "classic-seo",
      attainment: 0,
      title: `Poor performance: ${score}/100`,
      message: `Google PageSpeed Insights (mobile) rates the home page ${score}/100. ${vitals}. Slow pages hurt both classic SEO rankings and AI-crawler success rates.`,
    });
  }
  if (score < 75) {
    return sig("seo.cwv", {
      status: "partial",
      severity: "nice",
      discipline: "classic-seo",
      attainment: 0.5,
      title: `Performance: ${score}/100`,
      message: `Google PageSpeed Insights (mobile) rates the home page ${score}/100. ${vitals}. Below 75: focus on LCP and INP.`,
    });
  }
  return sig("seo.cwv", {
    status: "pass",
    severity: "nice",
    discipline: "classic-seo",
    attainment: 1,
    title: `Good performance: ${score}/100`,
    message: `Google PageSpeed Insights (mobile) rates the home page ${score}/100. ${vitals}.`,
  });
}
