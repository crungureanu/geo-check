"use strict";

// Same-origin Pages Functions: /api/scan and /api/r/:id are on this host.
const API_BASE = "";
const $ = (s) => document.querySelector(s);

const el = {
  landing: $("#landing"),
  loading: $("#loading"),
  loadingUrl: $("#loading-url"),
  results: $("#results"),
  error: $("#error"),
  errorMessage: $("#error-message"),
  form: $("#scan-form"),
  urlInput: $("#scan-url"),
  scanButton: $("#scan-button"),
  turnstileBox: $("#turnstile-box"),
  rUrl: $("#r-url"),
  rWhen: $("#r-when"),
  gaugeAi: $("#gauge-ai"),
  gaugeClassic: $("#gauge-classic"),
  headline: $("#headline"),
  perfMobile: $("#perf-mobile"),
  perfDesktop: $("#perf-desktop"),
  perfPair: $("#perf-pair"),
  perfCta: $("#perf-cta"),
  findingsCount: $("#findings-count"),
  filterChips: $("#filter-chips"),
  tiers: $("#tiers"),
  allClear: $("#all-clear"),
  passedPanel: $("#passed-panel"),
  passedCount: $("#passed-count"),
  passedList: $("#passed-list"),
  naPanel: $("#na-panel"),
  naCount: $("#na-count"),
  naList: $("#na-list"),
  deepLinks: $("#deep-links-row"),
  pagesPanel: $("#pages-panel"),
  pagesCount: $("#pages-count"),
  pagesList: $("#pages-list"),
  copyShare: $("#copy-share"),
  copyShare2: $("#copy-share-2"),
  scanAgain: $("#scan-again"),
  scanAnother: $("#scan-another"),
  retry: $("#retry"),
  shareInfo: $("#share-info"),
  badgeRow: $("#badge-row"),
  rubricAi: $("#rubric-ai"),
  rubricClassic: $("#rubric-classic"),
  didyouText: $("#didyou-text"),
  navFaq: $("#nav-faq"),
};

// Short, accurate facts shown on the scanning screen so the wait is
// useful. Kept brief so they are readable inside a single rotation.
const DID_YOU_KNOW = [
  "Most AI crawlers like GPTBot and ClaudeBot do not run JavaScript, so content rendered only by JS is often invisible to them.",
  "ChatGPT, Claude and Perplexity each use their own crawler user-agent, so robots.txt can allow or block them individually.",
  "llms.txt is an emerging convention: a Markdown file at your site root meant to point AI assistants to your key pages (vendor adoption is still limited).",
  "Perplexity cites its sources inline, so being citation-ready can earn real referral clicks, not just visibility.",
  "Google's AI Overviews draw from the same index as classic search, so solid technical SEO still feeds AI answers.",
  "Schema.org structured data helps AI models reliably extract your author, date and headline.",
  "AI assistants favour content that answers the question in the first sentence, before the supporting detail.",
  "GEO, AEO and AIO overlap but are not identical: GEO targets AI-generated answers, AEO targets direct-answer boxes, AIO usually means AI Overviews optimization.",
  "Blocking AI crawlers in robots.txt cuts you out of most AI answers but does not improve your Google ranking.",
  "Clear authorship and publish dates are among the strongest signals an AI uses when deciding whether to cite you.",
  "A valid XML sitemap helps AI crawlers find pages they would otherwise miss through link-only crawling.",
  "Headings phrased as real questions match how people actually prompt AI assistants.",
];

// Mirrors functions/_lib/scoring.ts SEVERITY_WEIGHT so the "fixing this
// gives back N points" figure is the real score impact, not invented.
const WEIGHT = {
  blocking: { fail: 25, warn: 10 },
  important: { fail: 10, warn: 5 },
  nice: { fail: 3, warn: 1 },
};
const TIER_META = {
  blocking: { label: "Blocking", cls: "tag-danger", desc: "Fix these first. They stop AI assistants indexing or citing your site." },
  important: { label: "Important", cls: "tag-warning", desc: "Significant score impact. Plan to fix this sprint." },
  nice: { label: "Nice to have", cls: "tag-success", desc: "Polish. Worth doing when you next touch the page." },
};
const AI_BADGES = [
  { name: "ChatGPT", color: "#10A37F", g: "G" },
  { name: "Claude", color: "#D97757", g: "C" },
  { name: "Perplexity", color: "#1F8FB8", g: "P" },
  { name: "Google AI Overviews", color: "#4285F4", g: "AI" },
];
const RUBRIC_AI = ["llms.txt present", "Schema.org Article", "Author markup", "Clear H1 / H2 hierarchy", "robots.txt allows GPTBot", "Open Graph metadata", "Citable factual sentences", "Page summary block", "Stable URLs", "Last-modified headers"];
const RUBRIC_CLASSIC = ["Title & meta length", "Internal link graph", "Canonical tags", "XML sitemap valid", "Mobile usability", "Core Web Vitals", "Image alt text", "HTTPS + redirects", "Structured headings", "Indexability"];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Did-you-know rotation: shuffle once, step through with no repeat
// until the deck is exhausted, then reshuffle. Only runs while the
// loading screen is visible.
let dykTimer = null, dykDeck = [], dykIdx = 0;
function nextDyk() {
  if (!el.didyouText) return;
  if (dykIdx >= dykDeck.length) {
    dykDeck = DID_YOU_KNOW.slice();
    for (let i = dykDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dykDeck[i], dykDeck[j]] = [dykDeck[j], dykDeck[i]];
    }
    dykIdx = 0;
  }
  el.didyouText.textContent = dykDeck[dykIdx++];
  el.didyouText.classList.remove("swap");
  void el.didyouText.offsetWidth; // restart fade animation
  el.didyouText.classList.add("swap");
}
function startDyk() {
  if (dykTimer) return;
  dykIdx = dykDeck.length; // force a reshuffle on first call
  nextDyk();
  dykTimer = setInterval(nextDyk, 8000);
}
function stopDyk() {
  if (dykTimer) { clearInterval(dykTimer); dykTimer = null; }
}

function showOnly(which) {
  el.landing.hidden = which !== "landing";
  el.loading.hidden = which !== "loading";
  el.results.hidden = which !== "results";
  el.error.hidden = which !== "error";
  if (which === "loading") startDyk(); else stopDyk();
  window.scrollTo(0, 0);
}

// ---------------- gauge (variant B1) ----------------
// Thick rounded gradient arc (fills 0->value), arrow needle, score
// numerals coloured by band (red at 0 -> green at 100), no ticks.
function gaugeColor(v) {
  return v < 40 ? "oklch(0.58 0.21 25)"      // red
    : v < 70 ? "oklch(0.74 0.16 70)"          // amber
    : "oklch(0.58 0.16 150)";                 // green
}
function gaugeSVG(value, size, thickness) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const t = thickness || Math.round(size * 0.092);
  const R = (size - t) / 2 - 4;
  const cx = size / 2, cy = size / 2 + 4;
  const start = -212, end = 32, sweep = end - start;
  const valAngle = start + sweep * (v / 100);
  const polar = (a, r) => { const rad = (a * Math.PI) / 180; return [cx + (r ?? R) * Math.cos(rad), cy + (r ?? R) * Math.sin(rad)]; };
  const arc = (a1, a2) => { const [x1, y1] = polar(a1); const [x2, y2] = polar(a2); const large = a2 - a1 > 180 ? 1 : 0; return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`; };
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  const col = gaugeColor(v);
  // arrow needle: tapered triangle from a small base at the hub to a
  // tip near the arc, plus a ring hub + centre dot, all in band colour.
  const [tx, ty] = polar(valAngle, R - t * 0.55);
  const perp = ((valAngle + 90) * Math.PI) / 180;
  const bw = size * 0.022;
  const b1x = cx + bw * Math.cos(perp), b1y = cy + bw * Math.sin(perp);
  const b2x = cx - bw * Math.cos(perp), b2y = cy - bw * Math.sin(perp);
  // At a perfect 100 the string is "100 / 100" (6 glyphs) and the big
  // numeral overflowed the dial, so shrink only the numerator at v===100.
  // The " / 100" suffix keeps its original small size and dimmed opacity.
  const perfect = v === 100;
  const num = size * (perfect ? 0.165 : 0.215);
  const den = size * 0.115;
  const denOp = 0.45;
  return `<svg width="${size}" height="${size * 0.80}" viewBox="0 0 ${size} ${size * 0.80}" style="overflow:visible">
    <defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="oklch(0.6 0.22 25)"/><stop offset="28%" stop-color="oklch(0.7 0.19 48)"/>
      <stop offset="52%" stop-color="oklch(0.82 0.16 90)"/><stop offset="76%" stop-color="oklch(0.74 0.17 135)"/>
      <stop offset="100%" stop-color="oklch(0.6 0.16 152)"/></linearGradient></defs>
    <path d="${arc(start, end)}" stroke="var(--paper-3)" stroke-width="${t}" stroke-linecap="round" fill="none"/>
    ${v > 0 ? `<path d="${arc(start, valAngle)}" stroke="url(#${gid})" stroke-width="${t}" stroke-linecap="round" fill="none"/>` : ""}
    <polygon points="${b1x} ${b1y} ${b2x} ${b2y} ${tx} ${ty}" fill="${col}"/>
    <circle cx="${cx}" cy="${cy}" r="${size * 0.05}" fill="var(--paper-2)" stroke="${col}" stroke-width="${size * 0.014}"/>
    <circle cx="${cx}" cy="${cy}" r="${size * 0.018}" fill="${col}"/>
    <text x="${cx}" y="${cy + size * 0.255}" text-anchor="middle" font-family="var(--font-sans)" font-weight="800" letter-spacing="-0.03em">
      <tspan fill="${col}" font-size="${num}">${v}</tspan><tspan fill="${col}" fill-opacity="${denOp}" font-size="${den}"> / 100</tspan>
    </text>
  </svg>`;
}
function statusWord(v) {
  return v >= 100 ? "PERFECT" : v >= 80 ? "STRONG" : v >= 60 ? "GOOD"
    : v >= 40 ? "FAIR" : v >= 20 ? "POOR" : "CRITICAL";
}
function renderGauge(node, value, label, size) {
  node.innerHTML = gaugeSVG(value, size) +
    `<div class="glabel">${label}</div><div class="gsub">${statusWord(Math.round(value))}</div>`;
}

// ---------------- web-vitals meter ----------------
function meter(label, displayValue, status, caption) {
  const pct = status === "good" ? 85 : status === "warn" ? 55 : 28;
  const color = status === "good" ? "var(--success)" : status === "warn" ? "var(--warning)" : "var(--danger)";
  return `<div class="meter"><div class="mrow"><span class="mk">${label}</span><span class="mv">${esc(displayValue)}</span></div>
    <div class="track"><div class="bar" style="width:${pct}%;background:${color}"></div></div>
    <div class="cap">${caption}</div></div>`;
}
function vital(kind, val) {
  if (val == null) return { disp: "n/a", status: "warn" };
  if (kind === "lcp") return { disp: (val / 1000).toFixed(2) + " s", status: val <= 2500 ? "good" : val <= 4000 ? "warn" : "bad" };
  if (kind === "inp") return { disp: Math.round(val) + " ms", status: val <= 200 ? "good" : val <= 500 ? "warn" : "bad" };
  return { disp: val.toFixed(3), status: val <= 0.1 ? "good" : val <= 0.25 ? "warn" : "bad" }; // cls
}
function renderPerf(node, device, ps) {
  const icon = device === "mobile"
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M11 18h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M9 21h6M12 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const head = `<div class="perf-head">${icon} ${device}</div>`;
  if (!ps || !ps.fetched || ps.performanceScore == null) {
    const why = ps && ps.error === "timeout"
      ? `The live PageSpeed test timed out for this site on ${device} (the site or Google's test was too slow). The rest of the report is unaffected; try again later for speed numbers.`
      : `Speed data unavailable for ${device}.`;
    node.innerHTML = head + `<div class="perf-missing">${why}</div>`;
    return;
  }
  const score = Math.round(ps.performanceScore * 100);
  const lcp = vital("lcp", ps.lcp), inp = vital("inp", ps.inp), cls = vital("cls", ps.cls);
  node.innerHTML = head +
    `<div class="gauge">${gaugeSVG(score, 180)}</div>` +
    `<div class="meters">${meter("LCP", lcp.disp, lcp.status, "Largest contentful paint")}${meter("INP", inp.disp, inp.status, "Interaction to next paint")}${meter("CLS", cls.disp, cls.status, "Cumulative layout shift")}</div>`;
}

// ---------------- findings ----------------
function impactText(f) {
  const w = f.weight || 0;
  if (w <= 0) return "";
  const where = f.discipline === "ai-seo" ? "AI SEO" : f.discipline === "classic-seo" ? "Classic SEO" : "both scores";
  // Points still on the table = the unearned share of this signal's weight.
  const a = typeof f.attainment === "number" ? Math.max(0, Math.min(1, f.attainment)) : 0;
  const left = Math.max(0, Math.round(w * (1 - a) * 10) / 10);
  const tier = w >= 8 ? "High impact" : w >= 4 ? "Medium impact" : "Low impact";
  return `${tier} · fixing this recovers up to <b>${left} weighted ${left === 1 ? "point" : "points"}</b> in ${where}`;
}
function discTag(d) {
  if (d === "ai-seo") return `<span class="tag tag-accent">AI SEO</span>`;
  if (d === "classic-seo") return `<span class="tag">Classic SEO</span>`;
  return `<span class="tag">Both</span>`;
}
function findingCard(f) {
  const t = TIER_META[f.severity] || TIER_META.nice;
  const node = document.createElement("article");
  node.className = "finding";
  node.dataset.discipline = f.discipline;
  const nPages = f.affectedPages ? f.affectedPages.length : 0;
  const pagesTag = nPages ? `<span class="tag" style="color:var(--muted)">${nPages} ${nPages === 1 ? "page" : "pages"}</span>` : "";
  const hasFix = !!f.fixSnippet;
  node.innerHTML = `
    <div class="body">
      <div class="tags">
        <span class="tag ${t.cls}"><span class="tag-dot"></span> ${t.label}</span>
        ${discTag(f.discipline)} ${pagesTag}
        <span class="sp"></span>
        ${hasFix ? `<button class="toggle" type="button">Show fix <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}
      </div>
      <h3>${esc(f.title)}</h3>
      <p class="msg">${esc(f.message)}</p>
      ${nPages ? `<p class="affected">Affects: ${esc(f.affectedPages.slice(0, 3).join(", "))}${nPages > 3 ? " and " + (nPages - 3) + " more" : ""}</p>` : ""}
      <p class="impact">${impactText(f)}</p>
    </div>
    ${hasFix ? `<div class="fixwrap"><div class="codeblock">
      <div class="cbhead"><span>fix</span><button class="cbcopy" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.45)"><rect x="8" y="8" width="12" height="12" rx="2.5" stroke-width="1.7"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke-width="1.7"/></svg></button></div>
      <pre></pre></div></div>` : ""}`;
  if (hasFix) {
    node.querySelector("pre").textContent = f.fixSnippet;
    node.querySelector(".toggle").addEventListener("click", () => {
      const open = node.classList.toggle("open");
      node.querySelector(".toggle").childNodes[0].nodeValue = open ? "Hide fix " : "Show fix ";
    });
    node.querySelector(".cbcopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(f.fixSnippet); } catch {}
    });
  }
  return node;
}

function makeHeadline(result) {
  const ai = result.scores.aiSeo, cl = result.scores.classicSeo;
  const blockers = result.findings.filter((f) => f.severity === "blocking" && f.status !== "pass");
  let s = `<strong>Headline:</strong> Classic SEO is ${statusWord(cl).toLowerCase()} (${cl}/100); AI citation-readiness is ${statusWord(ai).toLowerCase()} (${ai}/100).`;
  if (blockers.length) {
    s += ` Biggest wins: ${esc(blockers.slice(0, 2).map((b) => b.title).join("; "))}.`;
  } else {
    s += ` No blocking issues. Focus on the important items below.`;
  }
  return s;
}

let currentFilter = "all";
function applyFilter() {
  el.tiers.querySelectorAll(".finding").forEach((c) => {
    const d = c.dataset.discipline;
    const show = currentFilter === "all" || d === currentFilter || d === "both";
    c.style.display = show ? "" : "none";
  });
  el.tiers.querySelectorAll(".tier").forEach((sec) => {
    const any = [...sec.querySelectorAll(".finding")].some((c) => c.style.display !== "none");
    sec.style.display = any ? "" : "none";
  });
}

async function runSpeed(result, opts, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  // innerHTML so the inline spinner renders; on error we restore via
  // textContent below, which also wipes the spinner span. On success
  // the whole CTA is rebuilt by renderResult, so no cleanup needed.
  // Shorter than the original "Running PageSpeed… this can take 20-40s"
  // so it fits on narrow mobile screens. The static "Run Google
  // PageSpeed test" label was already the right width; this matches it.
  btn.innerHTML =
    `<span class="spinner-sm" aria-hidden="true"></span>Running PageSpeed… 20-40s`;
  let errEl = el.perfCta.querySelector(".speed-err");
  if (errEl) errEl.remove();
  try {
    const res = await fetch(`${API_BASE}/api/speed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Stored mode when we have a saved id; otherwise post the report
      // itself so the speed test still works with no KV-backed share.
      body: JSON.stringify(
        result.id ? { id: result.id } : { report: result },
      ),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    // The merged report carries the same id and an updated Classic SEO
    // score (Core Web Vitals now count). Re-render the whole result.
    renderResult(data.result, opts);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = orig;
    const p = document.createElement("p");
    p.className = "speed-err";
    p.style.cssText = "margin:8px 0 0;font-size:12.5px;line-height:1.5;color:var(--danger)";
    p.textContent = (e && e.message) || "Speed test failed. Try again later.";
    el.perfCta.appendChild(p);
  }
}

function renderResult(result, opts = {}) {
  const isShared = !!opts.isShared;
  el.rUrl.textContent = result.url;
  el.rWhen.textContent = `${new Date(result.scannedAt).toLocaleString()} · ${result.scannedPages.length} pages${isShared ? " · shared report" : ""}`;

  renderGauge(el.gaugeAi, result.scores.aiSeo, "AI SEO", 240);
  renderGauge(el.gaugeClassic, result.scores.classicSeo, "Classic SEO", 240);
  el.headline.innerHTML = makeHeadline(result);

  const perf = result.performance || { mobile: null, desktop: null };
  const hasPerf = !!(perf.mobile || perf.desktop);
  if (hasPerf) {
    el.perfPair.hidden = false;
    el.perfCta.hidden = true;
    renderPerf(el.perfMobile, "mobile", perf.mobile);
    renderPerf(el.perfDesktop, "desktop", perf.desktop);
  } else {
    // Phase 2: speed is opt-in. Offer to run it rather than show an
    // "unavailable" panel. Needs a saved report (an id) to merge into.
    el.perfPair.hidden = true;
    el.perfCta.hidden = false;
    // Centered in the right box with a small "Want a deeper look?"
    // cue + nudging arrow above the button so the affordance reads as
    // an invitation, not an orphan control. min-height + flex-end push
    // the stack toward the lower half so the eyebrow has room to breathe.
    el.perfCta.innerHTML =
      `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-height:220px;gap:10px;text-align:center;padding-bottom:8px">` +
        `<div style="font-weight:600;font-size:14px;color:var(--ink-2)">Want a deeper look?</div>` +
        `<div class="nudge-down" aria-hidden="true" style="font-size:20px;line-height:1;color:var(--accent);margin:-2px 0 2px">&#8595;</div>` +
        // max-width + white-space override the global .btn nowrap so a
        // long running-state label can wrap on narrow mobile screens
        // instead of pushing the whole page horizontally.
        `<button id="run-speed" class="btn btn-ghost" type="button" style="max-width:100%;white-space:normal;line-height:1.4">Run Google PageSpeed test</button>` +
        `<p style="margin:0;max-width:320px;font-size:12.5px;line-height:1.5;color:var(--muted)">Optional. Measures Core Web Vitals (LCP, INP, CLS) on your home page and folds them into the Classic SEO score. Adds roughly 20 to 40 seconds.</p>` +
      `</div>`;
    const btn = el.perfCta.querySelector("#run-speed");
    btn.addEventListener("click", () => runSpeed(result, opts, btn));
  }

  // findings -> tiers + passed
  const tiers = { blocking: [], important: [], nice: [] };
  const passed = [];
  for (const f of result.findings) {
    if (f.status === "pass") { if (f.message) passed.push(f); continue; }
    (tiers[f.severity] || tiers.nice).push(f);
  }
  const total = tiers.blocking.length + tiers.important.length + tiers.nice.length;
  el.findingsCount.textContent = total ? `· ${total} ${total === 1 ? "issue" : "issues"}` : "";
  el.tiers.innerHTML = "";
  for (const key of ["blocking", "important", "nice"]) {
    const items = tiers[key]; if (!items.length) continue;
    const t = TIER_META[key];
    const sec = document.createElement("section");
    sec.className = "tier";
    sec.innerHTML = `<div class="tier-head"><span class="tag ${t.cls}"><span class="tag-dot"></span> ${t.label} · ${items.length}</span><span class="desc">${t.desc}</span></div><div class="tier-list"></div>`;
    const list = sec.querySelector(".tier-list");
    items.forEach((f) => list.appendChild(findingCard(f)));
    el.tiers.appendChild(sec);
  }
  el.allClear.hidden = total > 0;
  applyFilter();

  // passed
  if (passed.length) {
    el.passedPanel.hidden = false;
    el.passedCount.textContent = `· ${passed.length}`;
    el.passedList.innerHTML = passed.map((p) =>
      `<div><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(p.title)}</span></div>`).join("");
  } else { el.passedPanel.hidden = true; }

  // not applicable (signals this site is not expected to need)
  const na = Array.isArray(result.notApplicable) ? result.notApplicable : [];
  if (el.naPanel) {
    if (na.length) {
      el.naPanel.hidden = false;
      el.naCount.textContent = `· ${na.length}`;
      el.naList.innerHTML = na.map((n) =>
        `<div><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>${esc(n.title)}</span></div>`).join("");
    } else { el.naPanel.hidden = true; }
  }

  // deep links
  el.deepLinks.innerHTML = "";
  (result.deepLinks || []).forEach((lnk, i) => {
    const b = AI_BADGES[i % AI_BADGES.length];
    const a = document.createElement("a");
    a.href = lnk.url; a.target = "_blank"; a.rel = "noopener"; a.className = "ty-card";
    a.innerHTML = `<span class="d" style="background:${b.color}">${b.g}</span><span style="flex:1;min-width:0"><span style="display:block;font-size:14px;font-weight:600">${esc(lnk.label)}</span><span class="mono" style="font-size:11px;color:var(--muted)">Ask about this site →</span></span>`;
    el.deepLinks.appendChild(a);
  });

  // pages
  el.pagesCount.textContent = result.scannedPages.length;
  el.pagesList.innerHTML = result.scannedPages.map((p) => {
    const you = p.url === result.url ? ` <span class="tag tag-accent" style="font-size:10px">you pasted this</span>` : "";
    return `<div class="pages-row"><span class="u">${esc(p.url)}</span><span class="tag" style="flex-shrink:0">${esc(p.type)}</span>${you}</div>`;
  }).join("");

  // share
  if (result.id && !isShared) {
    const url = `${window.location.origin}/r/${result.id}`;
    el.shareInfo.textContent = `Share link: ${url} (active for 7 days)`;
    for (const btn of [el.copyShare, el.copyShare2]) { btn.hidden = false; btn.dataset.url = url; }
  } else if (isShared) {
    el.shareInfo.textContent = "You are viewing a shared report.";
    el.copyShare.hidden = true; el.copyShare2.hidden = true;
  } else {
    el.shareInfo.textContent = "";
    el.copyShare.hidden = true; el.copyShare2.hidden = true;
  }

  showOnly("results");
}

// ---------------- scan ----------------
const turnstile = { active: false, widgetId: null, token: null, started: false };
async function setupTurnstile() {
  // Idempotent: deferred init means we may be called multiple times
  // (focus, pointerdown, timer fallback) and must only fetch config +
  // inject the script once.
  if (turnstile.started) return;
  turnstile.started = true;
  let cfg;
  try { cfg = await (await fetch(`${API_BASE}/api/config`)).json(); } catch { return; }
  const sitekey = cfg && cfg.turnstileSiteKey;
  if (!sitekey) return;
  turnstile.active = true;
  window.__onTurnstileLoad = () => {
    try {
      turnstile.widgetId = window.turnstile.render("#turnstile-box", {
        sitekey,
        callback: (t) => { turnstile.token = t; },
        "expired-callback": () => { turnstile.token = null; },
        "error-callback": () => { turnstile.token = null; },
      });
      el.turnstileBox.hidden = false;
    } catch {}
  };
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTurnstileLoad&render=explicit";
  s.async = true; s.defer = true;
  document.head.appendChild(s);
}
function resetTurnstile() {
  turnstile.token = null;
  if (turnstile.active && window.turnstile && turnstile.widgetId !== null) {
    try { window.turnstile.reset(turnstile.widgetId); } catch {}
  }
}

async function runScan(targetUrl) {
  el.loadingUrl.textContent = targetUrl;
  showOnly("loading");
  try {
    const res = await fetch(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl, turnstileToken: turnstile.token || undefined }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    renderResult(data.result);
  } catch (err) {
    el.errorMessage.textContent = err.message || "Something went wrong. Try again.";
    showOnly("error");
  } finally {
    el.scanButton.disabled = false;
    resetTurnstile();
  }
}

async function loadSharedReport(id) {
  el.loadingUrl.textContent = "(shared report)";
  showOnly("loading");
  try {
    const res = await fetch(`${API_BASE}/api/r/${encodeURIComponent(id)}`);
    if (res.status === 404) { el.errorMessage.textContent = "Shared report not found or expired (links live for 7 days)."; showOnly("error"); return; }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load report");
    renderResult(data.result, { isShared: true });
  } catch (err) {
    el.errorMessage.textContent = err.message || "Could not load shared report.";
    showOnly("error");
  }
}

function backToLanding() {
  el.urlInput.value = "";
  showOnly("landing");
  el.urlInput.focus();
}

// Lifetime social-proof line under the hero. Threshold avoids
// rendering 'Used to scan 3 websites' for a quiet day. Failure is
// silent: the line just stays hidden if the endpoint is unreachable.
const HERO_STATS_MIN_SCANS = 10;
async function loadHeroStats() {
  const el = {
    box: document.getElementById("hero-stats"),
    sites: document.getElementById("hs-sites"),
    pages: document.getElementById("hs-pages"),
  };
  if (!el.box || !el.sites || !el.pages) return;
  try {
    const r = await fetch(`${API_BASE}/api/stats`);
    if (!r.ok) return;
    const d = await r.json();
    if (!d || typeof d.scans !== "number" || d.scans < HERO_STATS_MIN_SCANS) return;
    el.sites.textContent = d.scans.toLocaleString("en-GB");
    el.pages.textContent = (d.pages || 0).toLocaleString("en-GB");
    el.box.hidden = false;
  } catch {}
}

function init() {
  el.badgeRow.innerHTML = AI_BADGES.map((b) =>
    `<span class="tag ai-badge"><span class="g" style="background:${b.color}">${b.g}</span>${b.name}</span>`).join("");
  // Hero stats line intentionally NOT shown for now (numbers are still
  // small). Backend keeps counting via /api/scan -> bumpTotalCounters,
  // and the totals are readable any time at /api/stats. To re-enable
  // the homepage display, uncomment the line below; the threshold
  // gate (HERO_STATS_MIN_SCANS) still applies.
  // loadHeroStats();
  el.rubricAi.innerHTML = RUBRIC_AI.map((x) => `<li><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${x}</li>`).join("");
  el.rubricClassic.innerHTML = RUBRIC_CLASSIC.map((x) => `<li><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${x}</li>`).join("");

  // Defer Turnstile (and the /api/config fetch it triggers) until the
  // user actually interacts with the page. Trades ~30-50KB of mobile
  // JS off the FCP/LCP path. A 2.5s timer is the safety net for users
  // who land and read without touching anything; in practice the first
  // pointerdown / keydown / scroll fires within the first second on
  // mobile, well before they can submit the form.
  let tsStarted = false;
  const kickTurnstile = () => {
    if (tsStarted) return;
    tsStarted = true;
    document.removeEventListener("pointerdown", kickTurnstile);
    document.removeEventListener("keydown", kickTurnstile);
    document.removeEventListener("scroll", kickTurnstile);
    setupTurnstile();
  };
  document.addEventListener("pointerdown", kickTurnstile, { once: true });
  document.addEventListener("keydown", kickTurnstile, { once: true });
  document.addEventListener("scroll", kickTurnstile, { once: true, passive: true });
  setTimeout(kickTurnstile, 2500);

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    // Belt and braces: if the user submits without ever firing
    // pointerdown / keydown / scroll (autofill, programmatic submit),
    // setupTurnstile would not have started yet. Calling it here is
    // idempotent and ensures the active+token check below means
    // something. They will see the "give it a second" message on the
    // first try and succeed on the second.
    setupTurnstile();
    let raw = el.urlInput.value.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    if (turnstile.active && !turnstile.token) {
      el.errorMessage.textContent = "Just finishing the human check. Give it a second, then try again.";
      showOnly("error");
      return;
    }
    el.scanButton.disabled = true;
    runScan(raw);
  });

  el.filterChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    currentFilter = chip.dataset.filter;
    el.filterChips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    applyFilter();
  });

  const copy = async (btn) => {
    const u = btn.dataset.url; if (!u) return;
    try { await navigator.clipboard.writeText(u); el.shareInfo.textContent = "Link copied to clipboard."; }
    catch { el.shareInfo.textContent = `Copy this link: ${u}`; }
  };
  el.copyShare.addEventListener("click", () => copy(el.copyShare));
  el.copyShare2.addEventListener("click", () => copy(el.copyShare2));
  el.retry.addEventListener("click", () => el.form.requestSubmit());
  el.scanAgain.addEventListener("click", backToLanding);
  el.scanAnother.addEventListener("click", backToLanding);

  // FAQ lives in the landing view; from a results/share/error view the
  // #faq anchor has nothing to scroll to. Always switch to landing,
  // then bring the FAQ into view.
  if (el.navFaq) {
    el.navFaq.addEventListener("click", (e) => {
      e.preventDefault();
      showOnly("landing");
      history.replaceState(null, "", "/#faq");
      const faq = document.getElementById("faq");
      if (faq) requestAnimationFrame(() => faq.scrollIntoView({ behavior: "smooth" }));
    });
  }

  // Cookie consent + Consent Mode v2 is handled by the inline script in
  // <head> on every page (window.xeoConsent*), so app.js no longer owns it.

  // Design-review only: ?demo renders the full results page from sample
  // data. Query-gated so real users never hit it; safe to keep as a
  // living style reference (no network, no KV).
  if (/(?:^|[?&])demo(?:=|&|$)/.test(window.location.search)) {
    renderResult(DEMO_RESULT, { isShared: true });
    return;
  }
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  if (m) loadSharedReport(m[1]); else showOnly("landing");
}

const DEMO_RESULT = {
  url: "https://acme.example.com/",
  scannedAt: new Date().toISOString(),
  scores: { aiSeo: 42, classicSeo: 78 },
  performance: {
    mobile: { fetched: true, performanceScore: 0.48, lcp: 4200, inp: 220, cls: 0.04 },
    desktop: { fetched: true, performanceScore: 0.86, lcp: 1600, inp: 48, cls: 0.02 },
  },
  deepLinks: [
    { label: "Ask ChatGPT", url: "https://chatgpt.com/" },
    { label: "Ask Claude", url: "https://claude.ai/" },
    { label: "Ask Perplexity", url: "https://www.perplexity.ai/" },
    { label: "Google AI", url: "https://www.google.com/search?q=acme" },
  ],
  scannedPages: [
    { url: "https://acme.example.com/", type: "home", status: 200 },
    { url: "https://acme.example.com/pricing", type: "pricing", status: 200 },
    { url: "https://acme.example.com/product/api", type: "product", status: 200 },
    { url: "https://acme.example.com/blog/observability-101", type: "article", status: 200 },
    { url: "https://acme.example.com/about", type: "about", status: 200 },
    { url: "https://acme.example.com/docs/quickstart", type: "other", status: 200 },
  ],
  findings: [
    { id: "ai.llms-txt", status: "fail", severity: "blocking", discipline: "ai-seo", title: "No llms.txt file found",
      message: "AI assistants check /llms.txt first for a curated map of your most citable content. Without it, they fall back to noisy crawling and may skip you entirely.",
      affectedPages: ["https://acme.example.com/"],
      fixSnippet: "# /llms.txt\n# Tell AI assistants what to read on your site.\n\n> Acme is the open-source observability platform.\n\n## Docs\n- [Quickstart](/docs/quickstart): 5-minute setup\n- [API reference](/docs/api): full HTTP API" },
    { id: "ai.robots-blocked", status: "fail", severity: "blocking", discipline: "ai-seo", title: "robots.txt blocks GPTBot, ClaudeBot and PerplexityBot",
      message: "Your robots.txt explicitly disallows the three largest AI crawlers. No model can index your content; you will not be cited." },
    { id: "ai.schema", status: "warn", severity: "important", discipline: "ai-seo", title: "Article schema missing on blog posts",
      message: "schema.org/Article markup gives assistants a clear handle on author, date and headline. 8 of 10 scanned pages lack any structured data.",
      affectedPages: ["https://acme.example.com/blog/observability-101", "https://acme.example.com/blog/how-we-built-x"] },
    { id: "seo.lcp", status: "warn", severity: "important", discipline: "classic-seo", title: "Largest Contentful Paint is poor on mobile (4.2s)",
      message: "Mobile LCP over 4s drops you from Google's Good band into Poor. The hero image is a 2.4 MB unoptimised PNG." },
    { id: "seo.alt", status: "warn", severity: "important", discipline: "both", title: "47 images missing alt text",
      message: "Hurts accessibility, classic image search, and AI summarisation of your pages." },
    { id: "seo.og", status: "warn", severity: "nice", discipline: "both", title: "Open Graph image is undersized (600x315)",
      message: "Recommended 1200x630 for crisp social cards and AI thumbnails." },
    { id: "ai.summary", status: "warn", severity: "nice", discipline: "ai-seo", title: "Add a one-paragraph page summary block",
      message: "A short factual summary near the top of long pages is a high-impact AI-SEO change after llms.txt." },
    { id: "seo.https", status: "pass", severity: "nice", discipline: "classic-seo", title: "HTTPS with a valid certificate" },
    { id: "seo.sitemap", status: "pass", severity: "nice", discipline: "both", title: "Sitemap.xml is fresh (under 7 days)" },
    { id: "seo.cwv-mediocre", status: "pass", severity: "nice", discipline: "classic-seo", title: "Mobile performance: 48/100",
      message: "Google PageSpeed Insights (mobile) rates the home page 48/100. LCP 4.20 s, INP 220 ms, CLS 0.040." },
  ],
};

init();
