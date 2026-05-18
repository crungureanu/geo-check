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
  findingsCount: $("#findings-count"),
  filterChips: $("#filter-chips"),
  tiers: $("#tiers"),
  allClear: $("#all-clear"),
  passedPanel: $("#passed-panel"),
  passedCount: $("#passed-count"),
  passedList: $("#passed-list"),
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
};

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
  { name: "Google AIO", color: "#4285F4", g: "AI" },
];
const RUBRIC_AI = ["llms.txt present", "Schema.org Article", "Author markup", "Clear H1 / H2 hierarchy", "robots.txt allows GPTBot", "Open Graph metadata", "Citable factual sentences", "Page summary block", "Stable URLs", "Last-modified headers"];
const RUBRIC_CLASSIC = ["Title & meta length", "Internal link graph", "Canonical tags", "XML sitemap valid", "Mobile usability", "Core Web Vitals", "Image alt text", "HTTPS + redirects", "Structured headings", "Indexability"];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function showOnly(which) {
  el.landing.hidden = which !== "landing";
  el.loading.hidden = which !== "loading";
  el.results.hidden = which !== "results";
  el.error.hidden = which !== "error";
  window.scrollTo(0, 0);
}

// ---------------- gauge (SVG, ported from the design system) ----------------
function gaugeSVG(value, size, thickness, showScale) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const R = (size - thickness) / 2 - 4;
  const cx = size / 2, cy = size / 2 + 4;
  const start = -210, end = 30, sweep = end - start;
  const valAngle = start + sweep * (v / 100);
  const polar = (a) => { const r = (a * Math.PI) / 180; return [cx + R * Math.cos(r), cy + R * Math.sin(r)]; };
  const arc = (a1, a2) => { const [x1, y1] = polar(a1); const [x2, y2] = polar(a2); const large = a2 - a1 > 180 ? 1 : 0; return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`; };
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  const col = v < 40 ? "oklch(0.6 0.2 25)" : v < 70 ? "oklch(0.78 0.14 75)" : "oklch(0.55 0.15 145)";
  let ticks = "";
  if (showScale) for (let i = 0; i <= 10; i++) {
    const a = start + (sweep * i) / 10, rad = (a * Math.PI) / 180;
    const r1 = R + thickness / 2 + 2, r2 = R + thickness / 2 + (i % 5 === 0 ? 10 : 6);
    ticks += `<line x1="${cx + r1 * Math.cos(rad)}" y1="${cy + r1 * Math.sin(rad)}" x2="${cx + r2 * Math.cos(rad)}" y2="${cy + r2 * Math.sin(rad)}" stroke="var(--line-strong)" stroke-width="${i % 5 === 0 ? 1.5 : 1}"/>`;
  }
  const [nx, ny] = polar(valAngle);
  return `<svg width="${size}" height="${size * 0.78}" viewBox="0 0 ${size} ${size * 0.78}" style="overflow:visible">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="oklch(0.6 0.2 25)"/><stop offset="35%" stop-color="oklch(0.72 0.17 50)"/>
      <stop offset="55%" stop-color="oklch(0.78 0.14 75)"/><stop offset="75%" stop-color="oklch(0.7 0.16 115)"/>
      <stop offset="100%" stop-color="oklch(0.6 0.16 145)"/></linearGradient></defs>
    <path d="${arc(start, end)}" stroke="var(--paper-3)" stroke-width="${thickness}" stroke-linecap="round" fill="none"/>
    <path d="${arc(start, valAngle)}" stroke="url(#${gid})" stroke-width="${thickness}" stroke-linecap="round" fill="none"/>
    ${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="8" fill="var(--paper-2)" stroke="var(--ink)" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="3" fill="var(--ink)"/>
    <text x="${cx}" y="${cy + size * 0.17}" text-anchor="middle" fill="${col}" font-size="${size * 0.22}" font-weight="700" font-family="var(--font-sans)" letter-spacing="-0.03em">${v}</text>
    <text x="${cx}" y="${cy + size * 0.26}" text-anchor="middle" fill="var(--muted)" font-size="${size * 0.058}" font-family="var(--font-mono)" letter-spacing=".1em">/ 100</text>
  </svg>`;
}
function band(v) { return v >= 80 ? "Good" : v >= 55 ? "Fair" : "Needs work"; }
function renderGauge(node, value, label, size, showScale) {
  node.innerHTML = gaugeSVG(value, size, size > 200 ? 16 : 12, showScale) +
    `<div class="glabel">${label}</div><div class="gsub">${band(value)}</div>`;
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
    node.innerHTML = head + `<div class="perf-missing">Speed data unavailable for ${device}.</div>`;
    return;
  }
  const score = Math.round(ps.performanceScore * 100);
  const lcp = vital("lcp", ps.lcp), inp = vital("inp", ps.inp), cls = vital("cls", ps.cls);
  node.innerHTML = head +
    `<div class="gauge">${gaugeSVG(score, 180, 12, false)}</div>` +
    `<div class="meters">${meter("LCP", lcp.disp, lcp.status, "Largest contentful paint")}${meter("INP", inp.disp, inp.status, "Interaction to next paint")}${meter("CLS", cls.disp, cls.status, "Cumulative layout shift")}</div>`;
}

// ---------------- findings ----------------
function impactText(f) {
  const w = WEIGHT[f.severity]; if (!w) return "";
  const pts = f.status === "fail" ? w.fail : w.warn;
  const where = f.discipline === "ai-seo" ? "AI SEO" : f.discipline === "classic-seo" ? "Classic SEO" : "both scores";
  return `Fixing this: <b>+${pts} to ${where}</b>`;
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
  let s = `<strong>Headline:</strong> Classic SEO is ${band(cl).toLowerCase()} (${cl}/100); AI citation-readiness is ${band(ai).toLowerCase()} (${ai}/100).`;
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

function renderResult(result, opts = {}) {
  const isShared = !!opts.isShared;
  el.rUrl.textContent = result.url;
  el.rWhen.textContent = `${new Date(result.scannedAt).toLocaleString()} · ${result.scannedPages.length} pages${isShared ? " · shared report" : ""}`;

  renderGauge(el.gaugeAi, result.scores.aiSeo, "AI SEO", 240, true);
  renderGauge(el.gaugeClassic, result.scores.classicSeo, "Classic SEO", 240, true);
  el.headline.innerHTML = makeHeadline(result);

  const perf = result.performance || { mobile: null, desktop: null };
  renderPerf(el.perfMobile, "mobile", perf.mobile);
  renderPerf(el.perfDesktop, "desktop", perf.desktop);

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
const turnstile = { active: false, widgetId: null, token: null };
async function setupTurnstile() {
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

function init() {
  el.badgeRow.innerHTML = AI_BADGES.map((b) =>
    `<span class="tag ai-badge"><span class="g" style="background:${b.color}">${b.g}</span>${b.name}</span>`).join("");
  el.rubricAi.innerHTML = RUBRIC_AI.map((x) => `<li><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${x}</li>`).join("");
  el.rubricClassic.innerHTML = RUBRIC_CLASSIC.map((x) => `<li><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${x}</li>`).join("");

  setupTurnstile();

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
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
