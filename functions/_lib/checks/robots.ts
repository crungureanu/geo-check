import type { CheckContext, Finding } from "../types";
import { sig, note } from "./_signal";

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
    // No robots.txt: crawlers assume open access, so AI can still read the
    // site. Mostly fine; small ding for not declaring access explicitly.
    findings.push(
      sig("robots.ai-access", {
        status: "partial",
        severity: "important",
        discipline: "ai-seo",
        attainment: 0.7,
        title: "No robots.txt found",
        message: `No /robots.txt at ${robotsUrl}. Crawlers will assume open access, which is usually fine. Add one if you want explicit control over which AI bots can read your site.`,
        fixSnippet: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`,
      }),
    );
    findings.push(indexableFinding(ctx));
    return findings;
  }

  const blocks = parseRobots(robots.body);

  const blockedList: { bot: typeof AI_BOTS[number]; via: "exact" | "wildcard" }[] = [];
  for (const bot of AI_BOTS) {
    const state = isUaBlocked(blocks, bot.name);
    if (state === "blocked") blockedList.push({ bot, via: "exact" });
    else if (state === "wildcard-blocked") blockedList.push({ bot, via: "wildcard" });
  }

  const exact = blockedList.filter((b) => b.via === "exact");
  const wildcardOnly = blockedList.filter((b) => b.via === "wildcard");
  const total = AI_BOTS.length;

  // The bots that actually drive AI citation. Blocking one of these is a
  // hard gate; blocking only a minor/secondary crawler (Amazonbot, CCBot,
  // Applebot-Extended, Meta-ExternalAgent) is a proportional penalty, not a
  // score-capping catastrophe (would otherwise tank an otherwise-fine site
  // to 25 for disallowing one obscure bot).
  const MAJOR = new Set([
    "GPTBot", "ChatGPT-User", "OAI-SearchBot",
    "ClaudeBot", "Claude-User", "Claude-SearchBot",
    "PerplexityBot", "Perplexity-User", "Google-Extended",
  ]);

  if (exact.length > 0) {
    const names = exact.map((b) => `${b.bot.name} (${b.bot.company})`).join(", ");
    const majorBlocked = exact.some((b) => MAJOR.has(b.bot.name));
    const attainment = Math.max(0, (total - exact.length) / total);
    findings.push(
      majorBlocked
        ? sig("robots.ai-access", {
            status: "fail",
            severity: "blocking",
            discipline: "ai-seo",
            attainment, // gateCap 25 applies (a major citation crawler is blocked)
            title: `${exact.length} AI crawler${exact.length === 1 ? "" : "s"} blocked in robots.txt`,
            message: `These AI crawlers cannot read your site and will not cite you: ${names}. Remove the matching Disallow rules in /robots.txt.`,
            fixSnippet: exact.map((b) => `User-agent: ${b.bot.name}\nAllow: /`).join("\n\n"),
          })
        : sig("robots.ai-access", {
            status: "partial",
            severity: "important",
            discipline: "ai-seo",
            attainment,
            noGate: true, // only secondary bots blocked: penalise, do not hard-cap
            title: `${exact.length} secondary AI crawler${exact.length === 1 ? "" : "s"} blocked in robots.txt`,
            message: `These secondary AI crawlers are blocked: ${names}. The major citation crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) are still allowed, so this is a partial loss, not a block. Remove the Disallow rules if the block is unintentional.`,
            fixSnippet: exact.map((b) => `User-agent: ${b.bot.name}\nAllow: /`).join("\n\n"),
          }),
    );
  } else if (wildcardOnly.length > 0) {
    findings.push(
      sig("robots.ai-access", {
        status: "fail",
        severity: "blocking",
        discipline: "ai-seo",
        attainment: 0,
        gateCap: 35, // wildcard block is recoverable per-bot; slightly softer cap than an explicit per-bot block
        title: "Wildcard Disallow blocks all crawlers, including AI",
        message: `Your robots.txt has 'User-agent: *' with 'Disallow: /'. This blocks every crawler (including AI assistants) from indexing your site. If this is intentional, ignore. Otherwise, override per-bot or remove the wildcard disallow.`,
        fixSnippet: AI_BOTS.slice(0, 6).map((b) => `User-agent: ${b.name}\nAllow: /`).join("\n\n"),
      }),
    );
  } else {
    findings.push(
      sig("robots.ai-access", {
        status: "pass",
        severity: "blocking",
        discipline: "ai-seo",
        attainment: 1,
        title: "AI crawlers can read your site",
        message: `All ${total} checked AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, and more) are allowed in robots.txt.`,
      }),
    );
  }

  // X-Robots-Tag header on home. The 'noai'/'noimageai' opt-out is an
  // unofficial signal most AI vendors ignore: surface it but DO NOT score it
  // (weight 0 note), so a site is not penalised for a directive that has no
  // agreed standing.
  const xRobots = (ctx.page.headers["x-robots-tag"] ?? "").toLowerCase();
  if (xRobots) {
    const noAi = /\bnoai\b/.test(xRobots);
    const noImg = /\bnoimageai\b/.test(xRobots);
    if (noAi || noImg) {
      findings.push(
        note("robots.x-robots-noai", {
          status: "warn",
          severity: "nice",
          discipline: "ai-seo",
          title: "X-Robots-Tag declares AI opt-out",
          message: `Your server sends X-Robots-Tag: "${xRobots}". The ${noAi ? "'noai'" : ""}${noAi && noImg ? " and " : ""}${noImg ? "'noimageai'" : ""} directive${noAi && noImg ? "s" : ""} are an unofficial opt-out signal (no W3C or IETF standard, and no major AI vendor has publicly committed to honour them). Most AI crawlers ignore these headers and obey robots.txt instead. Remove if you do want AI assistants to cite you.`,
        }),
      );
    }
  }

  findings.push(indexableFinding(ctx));
  return findings;
}

// noindex via X-Robots-Tag header OR meta robots, on the home page. One
// signal (both disciplines), gateCap 20: a noindex home page cannot rank or
// be cited regardless of everything else.
function indexableFinding(ctx: CheckContext): Finding {
  const xRobots = (ctx.page.headers["x-robots-tag"] ?? "").toLowerCase();
  const metaRobots = (ctx.page.metaRobots ?? "").toLowerCase();
  const xNoindex = /\bnoindex\b/.test(xRobots);
  const mNoindex = /\bnoindex\b/.test(metaRobots);
  if (xNoindex || mNoindex) {
    const via = xNoindex
      ? `X-Robots-Tag: ${xRobots}`
      : `<meta name="robots" content="${metaRobots}">`;
    return sig("robots.indexable", {
      status: "fail",
      severity: "blocking",
      discipline: "both",
      attainment: 0,
      title: "noindex on the home page",
      message: `Your home page declares noindex (${via}). Search engines and most AI assistants will skip this page entirely. Remove unless intentional.`,
    });
  }
  return sig("robots.indexable", {
    status: "pass",
    severity: "blocking",
    discipline: "both",
    attainment: 1,
    title: "Home page is indexable",
    message: "No noindex directive (meta or X-Robots-Tag) on the home page.",
  });
}
