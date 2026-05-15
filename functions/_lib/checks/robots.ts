import type { CheckContext, Finding } from "../types";

const AI_BOTS = [
  { name: "GPTBot", company: "OpenAI (training)" },
  { name: "ChatGPT-User", company: "OpenAI (user-triggered ChatGPT browsing)" },
  { name: "OAI-SearchBot", company: "OpenAI (search index)" },
  { name: "ClaudeBot", company: "Anthropic (training)" },
  { name: "Claude-User", company: "Anthropic (user-triggered Claude browsing)" },
  { name: "Claude-SearchBot", company: "Anthropic (search index)" },
  { name: "PerplexityBot", company: "Perplexity (search index)" },
  { name: "Perplexity-User", company: "Perplexity (user-triggered browsing)" },
  { name: "Google-Extended", company: "Google AI (Gemini, Vertex)" },
  { name: "CCBot", company: "Common Crawl (used by many AI trainers)" },
  { name: "Applebot-Extended", company: "Apple Intelligence" },
  { name: "Amazonbot", company: "Amazon" },
  { name: "Meta-ExternalAgent", company: "Meta (agents)" },
];

interface RobotsBlock {
  userAgents: string[];
  disallows: string[];
  allows: string[];
}

function parseRobots(txt: string): RobotsBlock[] {
  const blocks: RobotsBlock[] = [];
  let current: RobotsBlock | null = null;
  let lastWasUa = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasUa) {
        current = { userAgents: [], disallows: [], allows: [] };
        blocks.push(current);
      }
      current.userAgents.push(val);
      lastWasUa = true;
    } else if (current && key === "disallow") {
      current.disallows.push(val);
      lastWasUa = false;
    } else if (current && key === "allow") {
      current.allows.push(val);
      lastWasUa = false;
    } else {
      lastWasUa = false;
    }
  }
  return blocks;
}

function blockMatchesUa(block: RobotsBlock, ua: string): boolean {
  const u = ua.toLowerCase();
  return block.userAgents.some((b) => b.toLowerCase() === u);
}

function isUaBlocked(blocks: RobotsBlock[], ua: string): "blocked" | "allowed" | "wildcard-blocked" {
  const exact = blocks.filter((b) => blockMatchesUa(b, ua));
  for (const b of exact) {
    if (b.disallows.includes("/") && !b.allows.includes("/")) return "blocked";
    if (b.disallows.length > 0 && !b.disallows.includes("/")) return "allowed"; // partial, not root
    if (b.disallows.length === 0) return "allowed";
  }
  if (exact.length > 0) return "allowed";
  const wild = blocks.find((b) => b.userAgents.some((ua) => ua.trim() === "*"));
  if (wild && wild.disallows.includes("/") && !wild.allows.includes("/")) return "wildcard-blocked";
  return "allowed";
}

export function robotsChecks(ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  if (!ctx.isHome) return findings; // site-wide; only run for home page

  const robots = ctx.rootFiles.robots;
  const origin = new URL(ctx.page.finalUrl).origin;
  const robotsUrl = `${origin}/robots.txt`;

  if (!robots || !robots.ok) {
    findings.push({
      id: "robots.missing",
      status: "warn",
      severity: "important",
      discipline: "ai-seo",
      title: "No robots.txt found",
      message:
        `No /robots.txt at ${robotsUrl}. Crawlers will assume open access, which is usually fine. Add one if you want explicit control over which AI bots can read your site.`,
      fixSnippet:
        `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`,
    });
    return findings;
  }

  const blocks = parseRobots(robots.body);

  const blockedList: { bot: typeof AI_BOTS[number]; via: "exact" | "wildcard" }[] = [];
  for (const bot of AI_BOTS) {
    const state = isUaBlocked(blocks, bot.name);
    if (state === "blocked") blockedList.push({ bot, via: "exact" });
    else if (state === "wildcard-blocked") blockedList.push({ bot, via: "wildcard" });
  }

  if (blockedList.length > 0) {
    const exact = blockedList.filter((b) => b.via === "exact");
    if (exact.length > 0) {
      const names = exact.map((b) => `${b.bot.name} (${b.bot.company})`).join(", ");
      findings.push({
        id: "robots.ai-bots-blocked",
        status: "fail",
        severity: "blocking",
        discipline: "ai-seo",
        title: `${exact.length} AI crawler${exact.length === 1 ? "" : "s"} blocked in robots.txt`,
        message:
          `These AI crawlers cannot read your site and will not cite you: ${names}. Remove the matching Disallow rules in /robots.txt.`,
        fixSnippet: exact
          .map((b) => `User-agent: ${b.bot.name}\nAllow: /`)
          .join("\n\n"),
      });
    }
    const wildcardOnly = blockedList.filter((b) => b.via === "wildcard");
    if (wildcardOnly.length > 0) {
      findings.push({
        id: "robots.wildcard-blocks-ai",
        status: "warn",
        severity: "important",
        discipline: "ai-seo",
        title: "Wildcard Disallow blocks all crawlers, including AI",
        message:
          `Your robots.txt has 'User-agent: *' with 'Disallow: /'. This blocks every crawler (including AI assistants) from indexing your site. If this is intentional, ignore. Otherwise, override per-bot or remove the wildcard disallow.`,
        fixSnippet: AI_BOTS.slice(0, 6)
          .map((b) => `User-agent: ${b.name}\nAllow: /`)
          .join("\n\n"),
      });
    }
  } else {
    findings.push({
      id: "robots.ai-bots-allowed",
      status: "pass",
      severity: "blocking",
      discipline: "ai-seo",
      title: "AI crawlers can read your site",
      message: `All ${AI_BOTS.length} checked AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, and more) are allowed in robots.txt.`,
    });
  }

  // Check X-Robots-Tag header on home
  const xRobots = (ctx.page.headers["x-robots-tag"] ?? "").toLowerCase();
  if (xRobots) {
    const noAi = /\bnoai\b/.test(xRobots);
    const noImg = /\bnoimageai\b/.test(xRobots);
    const noIndex = /\bnoindex\b/.test(xRobots);
    if (noAi || noImg) {
      findings.push({
        id: "robots.x-robots-noai",
        status: "warn",
        severity: "important",
        discipline: "ai-seo",
        title: "X-Robots-Tag declares AI opt-out",
        message:
          `Your server sends X-Robots-Tag: "${xRobots}". The ${noAi ? "'noai'" : ""}${noAi && noImg ? " and " : ""}${noImg ? "'noimageai'" : ""} directive${noAi && noImg ? "s" : ""} are an unofficial opt-out signal (no W3C or IETF standard, and no major AI vendor has publicly committed to honour them). Most AI crawlers ignore these headers and obey robots.txt instead. Remove if you do want AI assistants to cite you.`,
      });
    }
    if (noIndex) {
      findings.push({
        id: "robots.x-robots-noindex",
        status: "fail",
        severity: "blocking",
        discipline: "both",
        title: "X-Robots-Tag: noindex on the home page",
        message:
          `Your server tells search engines not to index this page (X-Robots-Tag: ${xRobots}). This blocks both classic SEO and AI citation. Remove if unintentional.`,
      });
    }
  }

  // Meta robots
  const metaRobots = (ctx.page.metaRobots ?? "").toLowerCase();
  if (metaRobots && /\bnoindex\b/.test(metaRobots)) {
    findings.push({
      id: "robots.meta-noindex",
      status: "fail",
      severity: "blocking",
      discipline: "both",
      title: "Meta robots noindex on the home page",
      message:
        `Your home page has <meta name="robots" content="${metaRobots}">. Search engines and most AI assistants will skip this page. Remove unless intentional.`,
    });
  }

  return findings;
}
