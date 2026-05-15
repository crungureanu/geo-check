import type { CheckContext, Finding } from "../types";

export function discoveryChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const origin = new URL(ctx.page.finalUrl).origin;

  // ===== Site-wide checks (home page only) =====
  if (ctx.isHome) {
    // Sitemap
    const sitemap = ctx.rootFiles.sitemap;
    const sitemapUrl = ctx.rootFiles.sitemapUrl ?? `${origin}/sitemap.xml`;
    if (!sitemap || !sitemap.ok) {
      findings.push({
        id: "discovery.sitemap-missing",
        status: "warn",
        severity: "important",
        discipline: "both",
        title: "No sitemap.xml found",
        message:
          `Could not fetch a sitemap at ${sitemapUrl}. Sitemaps help crawlers (including AI bots) discover all your pages. Generate one and reference it in robots.txt.`,
        fixSnippet: `Sitemap: ${origin}/sitemap.xml`,
      });
    } else {
      findings.push({
        id: "discovery.sitemap-ok",
        status: "pass",
        severity: "important",
        discipline: "both",
        title: "Sitemap is reachable",
        message: `Sitemap found at ${sitemap.finalUrl}.`,
      });
    }

    // llms.txt
    const llms = ctx.rootFiles.llmsTxt;
    if (!llms || !llms.ok) {
      findings.push({
        id: "discovery.llms-txt-missing",
        status: "warn",
        severity: "nice",
        discipline: "ai-seo",
        title: "No llms.txt found",
        message:
          `llms.txt is an emerging standard for telling LLMs which pages best represent your site. Very few sites have one today — adding one is a fast credibility signal.`,
        fixSnippet: `# ${origin}\n# llms.txt — a curated index of your site for LLMs.\n# Place at: ${origin}/llms.txt\n\n# ${origin.replace(/^https?:\/\//, "")}\n\n> Short description of what your site offers.\n\n## Key pages\n\n- [Home](${origin}/): one-line description\n- [About](${origin}/about): one-line description\n- [Pricing](${origin}/pricing): one-line description`,
      });
    } else {
      const body = llms.body.trim();
      if (body.length < 50) {
        findings.push({
          id: "discovery.llms-txt-thin",
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          title: "llms.txt is present but very short",
          message:
            `Your /llms.txt is under 50 characters. Expand it with a short site description and links to your most important pages.`,
        });
      } else {
        findings.push({
          id: "discovery.llms-txt-ok",
          status: "pass",
          severity: "nice",
          discipline: "ai-seo",
          title: "llms.txt is present",
          message: `Good — your /llms.txt is reachable and not empty.`,
        });
      }
    }

    // HTTPS / HSTS
    if (!ctx.page.finalUrl.startsWith("https://")) {
      findings.push({
        id: "discovery.no-https",
        status: "fail",
        severity: "important",
        discipline: "both",
        title: "Site is not served over HTTPS",
        message:
          `${ctx.page.finalUrl} is served over plain HTTP. Most search engines and AI crawlers downrank or skip HTTP-only sites. Add a TLS certificate (Cloudflare and Let's Encrypt provide free ones).`,
      });
    } else {
      const hsts = ctx.page.headers["strict-transport-security"];
      if (!hsts) {
        findings.push({
          id: "discovery.no-hsts",
          status: "warn",
          severity: "nice",
          discipline: "classic-seo",
          title: "No HSTS header",
          message:
            `Add Strict-Transport-Security to enforce HTTPS for repeat visitors. Not critical for AI citation but a standard hardening step.`,
          fixSnippet: `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
        });
      }
    }
  }

  // ===== Per-page checks =====

  // Canonical
  if (!ctx.page.canonical) {
    findings.push({
      id: "discovery.no-canonical",
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: "No canonical tag",
      message:
        `${ctx.page.url} has no <link rel="canonical">. Add one to prevent duplicate-content confusion across query parameters, www vs apex, and HTTP vs HTTPS.`,
      fixSnippet: `<link rel="canonical" href="${ctx.page.finalUrl}" />`,
    });
  }

  // Lang attribute
  if (!ctx.page.lang) {
    findings.push({
      id: "discovery.no-lang",
      status: "warn",
      severity: "nice",
      discipline: "ai-seo",
      title: "No lang attribute on <html>",
      message:
        `Your <html> tag has no lang attribute. AI assistants use this to confirm content language. Add lang="en" (or the appropriate code).`,
      fixSnippet: `<html lang="en">`,
    });
  }

  // Redirect chain
  if (ctx.page.redirectChain > 1) {
    findings.push({
      id: "discovery.redirect-chain",
      status: "warn",
      severity: "nice",
      discipline: "classic-seo",
      title: `Redirect chain detected`,
      message:
        `Loading ${ctx.page.url} required ${ctx.page.redirectChain} redirect(s) before reaching ${ctx.page.finalUrl}. Each hop slows crawlers; collapse the chain to a single direct redirect.`,
    });
  }

  return findings;
}
