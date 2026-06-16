"use strict";

// Same-origin Pages Functions: /api/scan and /api/r/:id are on this host.
const API_BASE = "";
const $ = (s) => document.querySelector(s);

// Connection token (the per-person email unlock). Arrives once via the
// ?ct= link in the unlock email, then lives in localStorage so every
// later scan and report view unlocks the Content area automatically.
const CT_KEY = "xeo_ct";
function connToken() {
  try { return localStorage.getItem(CT_KEY) || null; } catch { return null; }
}
function captureConnToken() {
  const m = window.location.search.match(/[?&]ct=([a-z0-9]{10,40})\b/);
  if (!m) return;
  try { localStorage.setItem(CT_KEY, m[1]); } catch {}
  // Drop the token from the visible URL so it is not copied into shares.
  const u = new URL(window.location.href);
  u.searchParams.delete("ct");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
}

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
  heroGauge: $("#hero-gauge"),
  coverage: $("#coverage"),
  areaCards: $("#area-cards"),
  headline: $("#headline"),
  unlockOverlay: $("#unlock-overlay"),
  unlockClose: $("#unlock-close"),
  unlockForm: $("#unlock-form"),
  unlockEmail: $("#unlock-email"),
  unlockSubmit: $("#unlock-submit"),
  unlockDone: $("#unlock-done"),
  unlockSentTo: $("#unlock-sent-to"),
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

// ---------------- scan-ladder hero (handoff: Variation 2 "Card ladder") ----------------
// Score bands shared by the dial, bars and value tags. Hexes come from
// the design handoff tokens (temp/xeoscan-reporting-pages README).
function scoreBand(v) {
  if (v == null) return { c: "#a1a1aa", label: "Not scored" };
  if (v >= 90) return { c: "#15a34a", label: "Strong" };
  if (v >= 70) return { c: "#3f9d3a", label: "Good" };
  if (v >= 50) return { c: "#e08a0b", label: "Fair" };
  return { c: "#d6402a", label: "Poor" };
}
function statusWord(v) {
  return v >= 100 ? "PERFECT" : v >= 80 ? "STRONG" : v >= 60 ? "GOOD"
    : v >= 40 ? "FAIR" : v >= 20 ? "POOR" : "CRITICAL";
}

// 270° speedometer: red→green spectrum fills 0→score, light tracker ring
// for the remainder, tapered needle + hub, "OVERALL SCORE" under the
// number. Geometry ported 1:1 from the handoff gauge.jsx.
function heroGaugeSVG(score, size) {
  const v = Math.max(0, Math.min(100, Math.round(score)));
  const track = Math.round(size * 0.073); // ≈20 at 272px
  const A0 = 135, SWEEP = 270;
  const cx = size / 2;
  const pad = track / 2 + 4;
  const R = size / 2 - pad;
  const cy = R + pad;
  const bottomY = cy + R * Math.sin((45 * Math.PI) / 180);
  const numY = cy + R * 0.55;
  const statusY = numY + size * 0.12;
  const height = Math.max(bottomY + track / 2, statusY + size * 0.05) + 8;
  const band = scoreBand(v);
  const vAng = A0 + (v / 100) * SWEEP;
  const polar = (r, deg) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (r, a0, a1) => {
    const [x0, y0] = polar(r, a0); const [x1, y1] = polar(r, a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const hueFor = (t) => 8 + Math.max(0, Math.min(1, t)) * (132 - 8);
  // filled spectrum as fine segments so the ramp always ends green at the tip
  let segs = "";
  const totalSegs = Math.max(2, Math.round((vAng - A0) / 2.4));
  for (let i = 0; i < totalSegs; i++) {
    const a = A0 + ((vAng - A0) * i) / totalSegs;
    const b = A0 + ((vAng - A0) * (i + 1)) / totalSegs;
    const t = totalSegs <= 1 ? 1 : i / (totalSegs - 1);
    segs += `<path d="${arc(R, a, b + 0.6)}" stroke="hsl(${hueFor(t)} 70% 47%)" stroke-width="${track}" fill="none" stroke-linecap="${i === 0 ? "round" : "butt"}"/>`;
  }
  const [tipX, tipY] = polar(R, vAng - 0.4);
  const [nx, ny] = polar(R * 0.82, vAng);
  const halfBase = track * 0.30;
  const [bx1, by1] = polar(halfBase, vAng + 90);
  const [bx2, by2] = polar(halfBase, vAng + 270);
  return `<svg width="${size}" height="${Math.round(height)}" viewBox="0 0 ${size} ${Math.round(height)}" style="display:block">
    <path d="${arc(R, A0, A0 + SWEEP)}" stroke="#eceae6" stroke-width="${track}" fill="none" stroke-linecap="round"/>
    ${segs}
    ${v > 1 ? `<circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${track / 2}" fill="hsl(${hueFor(1)} 70% 47%)"/>` : ""}
    <polygon points="${nx.toFixed(1)},${ny.toFixed(1)} ${bx1.toFixed(1)},${by1.toFixed(1)} ${bx2.toFixed(1)},${by2.toFixed(1)}" fill="${band.c}"/>
    <circle cx="${cx}" cy="${cy}" r="${track * 0.40}" fill="#fff" stroke="${band.c}" stroke-width="${track * 0.15}"/>
    <circle cx="${cx}" cy="${cy}" r="${track * 0.13}" fill="${band.c}"/>
    <text text-anchor="end" x="${cx - 1}" y="${numY}" font-family="var(--font-sans)" font-size="${size * 0.195}" font-weight="700" fill="${band.c}" letter-spacing="-0.03em">${v}</text>
    <text text-anchor="start" x="${cx + size * 0.028}" y="${numY}" font-family="var(--font-sans)" font-size="${size * 0.1}" font-weight="500" fill="#a1a1aa">/100</text>
    <text text-anchor="middle" x="${cx}" y="${statusY}" font-family="var(--font-mono)" font-size="${size * 0.055}" font-weight="600" fill="#71717a" letter-spacing="0.14em">OVERALL SCORE</text>
  </svg>`;
}

// "Based on N of 4 areas scanned" + 4-segment progress bar + % readout.
// All four segments turn green and the label flips at full coverage.
function coverageHTML(cov) {
  const all = cov >= 4;
  const label = all
    ? `<span class="cov-all"><span class="cov-check"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>All areas scanned</span>`
    : `<span class="cov-label">Based on <strong>${cov} of 4 areas</strong> scanned</span>`;
  const segs = [0, 1, 2, 3].map((i) =>
    `<span class="cov-seg${i < cov ? (all ? " on-all" : " on") : ""}"></span>`).join("");
  return `<div class="cov-row">${label}<span class="cov-pct mono">${Math.round((cov / 4) * 100)}%</span></div><div class="cov-segs">${segs}</div>`;
}

// ---------------- area cards ----------------
const ICO = {
  check: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lock: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.4"/><path d="M5.3 7V5.2a2.7 2.7 0 015.4 0V7"/></svg>`,
  clock: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/></svg>`,
  bolt: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 2L4 9h3.5L7 14l4.5-7H8z"/></svg>`,
  phone: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#71717a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="2" width="7" height="12" rx="1.6"/><path d="M7 12h2"/></svg>`,
  desktop: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#71717a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M6 14h4M8 11v3"/></svg>`,
};

function valueTag(score) {
  return `<span class="value-tag"><span class="vt-num" style="color:${scoreBand(score).c}">${score}</span><span class="vt-den">/100</span></span>`;
}
function areaBar(value, mods) {
  const cls = "area-bar" + (mods ? " " + mods : "");
  const fill = value == null ? "" :
    `<span class="area-fill" style="width:${Math.max(0, Math.min(100, value))}%;background:${scoreBand(value).c}"></span>`;
  return `<span class="${cls}">${fill}</span>`;
}
function miniMeter(label, val) {
  return `<div class="mini-meter">
    <div class="mm-row"><span class="mm-label">${label}</span><span class="mm-val" style="color:${scoreBand(val).c}">${val}<span>/100</span></span></div>
    ${areaBar(val, "h6")}
  </div>`;
}
function speedSubRow(icon, name, ps) {
  const has = ps && ps.fetched && ps.performanceScore != null;
  const score = has ? Math.round(ps.performanceScore * 100) : null;
  const right = has
    ? `<span class="sub-score" style="color:${scoreBand(score).c}">${score}<span>/100</span></span>`
    : `<span class="sub-score na">n/a</span>`;
  return `<div class="speed-sub">
    <div class="sub-head">${icon}<span class="sub-name">${name}</span>${right}</div>
    ${areaBar(score, "h8")}
  </div>`;
}

// Area weights for the overall score (decided 2026-06-12): how much
// each area contributes to "will AI cite you". Technical gates
// everything; Speed matters least to citation; Content is the
// citability proxy; Citations measures outcomes the others cause.
// With partial coverage the weights renormalise over the scanned
// areas, so the overall is always an honest weighted average of what
// was measured. Computed at render time, never stored: re-tuning
// these never breaks old reports.
const AREA_WEIGHT = { technical: 40, speed: 15, content: 25, citations: 20 };

// Builds the four SCAN LADDER cards from the scan result. Phase 1:
// Technical + Speed are live, Content is the email-locked shell,
// Citations is the coming-soon shell.
function ladderModel(result) {
  const ai = result.scores.aiSeo, classic = result.scores.classicSeo;
  const technical = Math.round((ai + classic) / 2);
  const perf = result.performance || {};
  const speeds = [perf.mobile, perf.desktop]
    .filter((p) => p && p.fetched && p.performanceScore != null)
    .map((p) => Math.round(p.performanceScore * 100));
  const speedDone = speeds.length > 0;
  const speedScore = speedDone ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null;
  const contentDone = typeof result.scores.content === "number";
  const contentScore = contentDone ? result.scores.content : null;
  const scanned = [{ w: AREA_WEIGHT.technical, s: technical }];
  if (speedDone) scanned.push({ w: AREA_WEIGHT.speed, s: speedScore });
  if (contentDone) scanned.push({ w: AREA_WEIGHT.content, s: contentScore });
  const wSum = scanned.reduce((a, x) => a + x.w, 0);
  return {
    technical, ai, classic, perf, speedDone, speedScore, contentDone, contentScore,
    coverage: 1 + (speedDone ? 1 : 0) + (contentDone ? 1 : 0),
    overall: Math.round(scanned.reduce((a, x) => a + x.w * x.s, 0) / wSum),
  };
}

function renderLadder(result, opts) {
  const m = ladderModel(result);
  const dialSize = window.matchMedia("(max-width: 640px)").matches ? 232 : 272;
  el.heroGauge.innerHTML = heroGaugeSVG(m.overall, dialSize);
  el.coverage.innerHTML = coverageHTML(m.coverage);

  const doneTag = `<span class="area-tag-done">${ICO.check}</span>`;
  const cards = [];
  cards.push(`<div class="area-card">
    <div class="ac-head">
      <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Technical</span>${doneTag}</div><div class="ac-note">Runs with every scan</div></div>
      ${valueTag(m.technical)}
    </div>
    <div class="ac-body">${areaBar(m.technical, "h10")}
      <div class="mini-pair">${miniMeter("AI SEO", m.ai)}${miniMeter("Classic SEO", m.classic)}</div>
    </div>
  </div>`);

  if (m.speedDone) {
    cards.push(`<div class="area-card">
      <div class="ac-head">
        <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Speed</span>${doneTag}</div><div class="ac-note">Mobile and desktop</div></div>
        ${valueTag(m.speedScore)}
      </div>
      <div class="ac-body speed-subs">
        ${speedSubRow(ICO.phone, "Mobile", m.perf.mobile)}
        ${speedSubRow(ICO.desktop, "Desktop", m.perf.desktop)}
      </div>
    </div>`);
  } else {
    cards.push(`<div class="area-card">
      <div class="ac-head">
        <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Speed</span></div><div class="ac-note">Optional. Adds about 30 seconds.</div></div>
      </div>
      <div class="ac-body ac-action-row">${areaBar(null)}
        <button id="run-speed" class="btn btn-purple ac-btn" type="button">${ICO.bolt} Run speed test</button>
      </div>
    </div>`);
  }

  if (m.contentDone) {
    cards.push(`<div class="area-card">
      <div class="ac-head">
        <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Content</span>${doneTag}</div><div class="ac-note">Deep checks on how citable your content really is</div></div>
        ${valueTag(m.contentScore)}
      </div>
      <div class="ac-body">${areaBar(m.contentScore, "h10")}</div>
    </div>`);
  } else if (connToken()) {
    // Unlocked subscriber: Content is never auto-filled on a fresh scan.
    // They request it with this button, which reveals the score for this
    // report (computed with the scan, held back until asked).
    cards.push(`<div class="area-card locked">
      <div class="ac-head">
        <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Content</span></div><div class="ac-note">You are unlocked. Run the Content scan to see how citable your pages are.</div></div>
      </div>
      <div class="ac-body ac-action-row">${areaBar(null, "hatch")}
        <button id="content-run" class="btn btn-purple ac-btn" type="button">${ICO.bolt} Run content scan</button>
      </div>
    </div>`);
  } else {
    cards.push(`<div class="area-card locked">
      <div class="ac-head">
        <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Content</span></div><div class="ac-note">Deep checks on how citable your content really is</div></div>
      </div>
      <div class="ac-body ac-action-row">${areaBar(null, "hatch")}
        <button id="unlock-open" class="btn btn-purple ac-btn" type="button">${ICO.lock} Unlock FREE</button>
      </div>
    </div>`);
  }

  cards.push(`<div class="area-card soon">
    <div class="ac-head">
      <div class="ac-name-wrap"><div class="ac-name-row"><span class="ac-name">Citations</span><span class="area-tag-soon">${ICO.clock} Coming soon</span></div><div class="ac-note">AI-powered. We are still building this scan.</div></div>
    </div>
    <div class="ac-body">${areaBar(null, "soon")}</div>
  </div>`);

  el.areaCards.innerHTML = cards.join("");

  const speedBtn = el.areaCards.querySelector("#run-speed");
  if (speedBtn) speedBtn.addEventListener("click", () => runSpeed(result, opts, speedBtn));
  const unlockBtn = el.areaCards.querySelector("#unlock-open");
  if (unlockBtn) unlockBtn.addEventListener("click", () => openUnlock(result));
  const contentRunBtn = el.areaCards.querySelector("#content-run");
  if (contentRunBtn) contentRunBtn.addEventListener("click", () => revealContent(result, contentRunBtn, opts));
}

// ---------------- unlock modal (Content scan email gate) ----------------
let unlockCtx = null;
function openUnlock(result) {
  unlockCtx = { url: result.url, id: result.id || null };
  el.unlockForm.hidden = false;
  el.unlockDone.hidden = true;
  el.unlockSubmit.disabled = false;
  el.unlockOverlay.hidden = false;
  document.body.classList.add("modal-open");
  setTimeout(() => { try { el.unlockEmail.focus(); } catch {} }, 50);
}
function closeUnlock() {
  el.unlockOverlay.hidden = true;
  document.body.classList.remove("modal-open");
}
async function submitUnlock(e) {
  e.preventDefault();
  const email = el.unlockEmail.value.trim();
  if (!email) return;
  el.unlockSubmit.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        url: unlockCtx ? unlockCtx.url : "",
        id: unlockCtx ? unlockCtx.id : null,
        company: el.unlockForm.querySelector(".hp").value || "",
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || "Could not send right now. Please try again.");
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "unlock_requested", scan_url: unlockCtx ? unlockCtx.url : "" });
    } catch {}
    const doneP = el.unlockDone.querySelector("p");
    if (data.sent === false) {
      doneP.innerHTML = `<strong>Saved.</strong> I could not send the email automatically right now, but I have your address and will send your unlock link personally.`;
    } else {
      doneP.innerHTML = `<strong>Check your inbox.</strong> Your unlock link is on its way to <span id="unlock-sent-to"></span>.`;
      doneP.querySelector("#unlock-sent-to").textContent = email;
    }
    el.unlockForm.hidden = true;
    el.unlockDone.hidden = false;
  } catch (err) {
    el.unlockSubmit.disabled = false;
    alert(err.message || "Could not send right now. Please try again.");
  }
}

// ---------------- findings ----------------
// Overall-score conversion factors, set per render (see renderResult).
let _impactCtx = null;
const PILLAR_LABEL = { ai: "AI SEO", classic: "Classic SEO", content: "Content" };
function fmtPts(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
function impactText(f) {
  const pp = Array.isArray(f.pillarPoints) ? f.pillarPoints.filter((p) => p.points > 0) : null;
  if (pp && pp.length) {
    // Each finding's points are attributed to its TRUE pillar and normalised
    // so a pillar's findings sum to (100 - that pillar's score).
    const perPillar = pp.map((p) => `${fmtPts(p.points)} ${PILLAR_LABEL[p.pillar] || ""}`).join(" + ");
    let overall = 0;
    if (_impactCtx) {
      for (const p of pp) overall += p.points * (p.pillar === "content" ? _impactCtx.contentF : _impactCtx.aiClassicF);
    }
    const tier = f.weight >= 8 ? "High impact" : f.weight >= 4 ? "Medium impact" : "Low impact";
    const noun = pp.length === 1 && pp[0].points === 1 ? "point" : "points";
    const overallStr = overall > 0 ? ` (about +${fmtPts(overall)} to your overall score)` : "";
    return `${tier} · fixing this recovers up to <b>${perPillar} ${noun}</b>${overallStr}`;
  }
  // Fallback for reports stored before per-pillar points shipped.
  const w = f.weight || 0;
  if (w <= 0) return "";
  const where = f.discipline === "ai-seo" ? "AI SEO" : f.discipline === "classic-seo" ? "Classic SEO" : "both scores";
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
// Tag shown on the card. Content-depth findings carry discipline "ai-seo"
// (so the AI SEO filter chip still catches them) but belong to the Content
// pillar, so label them Content to match their impact line.
function pillarTag(f) {
  const pp = f.pillarPoints;
  if (pp && pp.length === 1 && pp[0].pillar === "content") return `<span class="tag tag-accent">Content</span>`;
  return discTag(f.discipline);
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
        ${pillarTag(f)} ${pagesTag}
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

// Reveal the Content score for an unlocked subscriber on demand. Content is
// computed with the scan and stored, but held back from the response so a
// fresh scan shows Technical only; this fetches the stored report with the
// connection token (no re-email) and merges it in.
async function revealContent(result, btn, opts = {}) {
  const ct = connToken();
  if (!ct) { openUnlock(result); return; }       // not actually unlocked
  if (!result.id) { openUnlock(result); return; } // nothing stored to reveal from
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-sm" aria-hidden="true"></span>Running…`;
  const card = btn.closest(".area-card");
  const prevErr = card ? card.querySelector(".content-err") : null;
  if (prevErr) prevErr.remove();
  try {
    const res = await fetch(`${API_BASE}/api/r/${encodeURIComponent(result.id)}?ct=${encodeURIComponent(ct)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    if (typeof data.result?.scores?.content !== "number") {
      throw new Error("The content scan is not available for this report.");
    }
    renderResult(mergeResults(result, data.result), opts);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = orig;
    const p = document.createElement("p");
    p.className = "content-err";
    p.style.cssText = "margin:8px 0 0;font-size:12.5px;line-height:1.5;color:var(--danger)";
    p.textContent = (e && e.message) || "Could not load the content scan. Try again.";
    if (card) card.appendChild(p);
  }
}

async function runSpeed(result, opts, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  // innerHTML so the inline spinner renders; on error we restore the
  // original label below. On success the whole ladder is rebuilt by
  // renderResult, so no cleanup needed.
  btn.innerHTML =
    `<span class="spinner-sm" aria-hidden="true"></span>Running… 20-40s`;
  const card = btn.closest(".area-card");
  let errEl = card ? card.querySelector(".speed-err") : null;
  if (errEl) errEl.remove();
  try {
    const res = await fetch(`${API_BASE}/api/speed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Stored mode when we have a saved id; otherwise post the report
      // itself so the speed test still works with no KV-backed share.
      // No connection token: running Speed must not also reveal Content
      // (that is an explicit, separate request). mergeResults below keeps
      // a Content score that was ALREADY revealed on screen.
      body: JSON.stringify(
        result.id ? { id: result.id } : { report: result },
      ),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    // The merged report carries the same id and an updated Classic SEO
    // score (Core Web Vitals now count). Merge over the current report so a
    // Content score already revealed on screen is preserved (the gated
    // response does not carry it).
    renderResult(mergeResults(result, data.result), opts);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = orig;
    const p = document.createElement("p");
    p.className = "speed-err";
    p.style.cssText = "margin:8px 0 0;font-size:12.5px;line-height:1.5;color:var(--danger)";
    p.textContent = (e && e.message) || "Speed test failed. Try again later.";
    if (card) card.appendChild(p);
  }
}

// (removed: currentResult / auto-rescan — rescans are now manual)
// Merge a freshly-fetched area result over the one on screen WITHOUT
// dropping areas it does not carry. Running Speed returns a report with no
// contentFindings if the token check hiccups; without this, a manual Speed
// run could wipe an already-unlocked Content score. Each tier is requested
// manually, so this only ever ADDS the requested area, never removes one.
function mergeResults(prev, next) {
  if (!prev) return next;
  const out = { ...next };
  if (typeof prev.scores?.content === "number" && typeof out.scores?.content !== "number") {
    out.scores = { ...out.scores, content: prev.scores.content };
    if (prev.contentFindings && !out.contentFindings) out.contentFindings = prev.contentFindings;
  }
  if (prev.performance && !out.performance) out.performance = prev.performance;
  return out;
}

function renderResult(result, opts = {}) {
  const isShared = !!opts.isShared;
  el.rUrl.textContent = result.url;
  el.rWhen.textContent = `${new Date(result.scannedAt).toLocaleString()} · ${result.scannedPages.length} pages${isShared ? " · shared report" : ""}`;

  renderLadder(result, opts);
  el.headline.innerHTML = makeHeadline(result);

  // Per-finding impact lines convert their pillar points into an "overall"
  // delta using the same AREA_WEIGHT blend as the hero gauge. AI/Classic
  // findings roll into technical = (ai + classic) / 2; Content into the
  // content area. Coverage-dependent, so recomputed on every render.
  {
    const perf = result.performance || {};
    const speedDone = [perf.mobile, perf.desktop].some((p) => p && p.fetched && p.performanceScore != null);
    const contentDone = typeof result.scores.content === "number";
    const wSum = AREA_WEIGHT.technical + (speedDone ? AREA_WEIGHT.speed : 0) + (contentDone ? AREA_WEIGHT.content : 0);
    _impactCtx = {
      aiClassicF: (0.5 * AREA_WEIGHT.technical) / wSum,
      contentF: AREA_WEIGHT.content / wSum,
    };
  }

  // findings -> tiers + passed. Content-depth findings (present only on
  // unlocked reports) merge into the same list; they carry discipline
  // "ai-seo" so the existing filter chips apply.
  const allFindings = result.contentFindings
    ? result.findings.concat(result.contentFindings)
    : result.findings;
  const tiers = { blocking: [], important: [], nice: [] };
  const passed = [];
  for (const f of allFindings) {
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
    for (const btn of [el.copyShare, el.copyShare2]) { btn.hidden = false; btn.dataset.url = url; btn.dataset.id = result.id; }
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

// Poll briefly for a Turnstile token. The widget issues one
// asynchronously, and resetTurnstile() (after every scan) clears it, so a
// rescan fired right away would otherwise find no token and fail the human
// check. Returns the token (possibly still null after the wait).
async function waitForToken(ms = 5000) {
  const start = Date.now();
  while (!turnstile.token && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 150));
  }
  return turnstile.token;
}

async function runScan(targetUrl) {
  el.loadingUrl.textContent = targetUrl;
  showOnly("loading");
  try {
    const res = await fetch(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deliberately NOT sending the connection token: a fresh scan must
      // show Technical only. An unlocked subscriber reveals Content on
      // demand via the "Run content scan" button (revealContent).
      body: JSON.stringify({ url: targetUrl, turnstileToken: turnstile.token || undefined }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    // Conversion signal for ad platforms (Meta Pixel / GA4 / Ads), fired
    // through GTM's dataLayer so the page code stays vendor-neutral.
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "scan_completed",
        scan_url: data.result?.url,
        ai_score: data.result?.scores?.aiSeo,
        classic_score: data.result?.scores?.classicSeo,
      });
    } catch {}
    renderResult(data.result);
  } catch (err) {
    showError(err.message || "Something went wrong. Try again.");
  } finally {
    el.scanButton.disabled = false;
    resetTurnstile();
  }
}

// Render an error in the error panel. Bolds the domain-spelling hint when
// present (the commonest cause of a failed scan) so it stands out. Uses DOM
// text nodes, never innerHTML, because the message embeds the user's URL.
function showError(msg) {
  const PHRASE = "double-check the domain is spelled correctly";
  el.errorMessage.textContent = "";
  const i = msg.indexOf(PHRASE);
  if (i === -1) {
    el.errorMessage.textContent = msg;
  } else {
    el.errorMessage.appendChild(document.createTextNode(msg.slice(0, i)));
    const strong = document.createElement("strong");
    strong.textContent = PHRASE;
    el.errorMessage.appendChild(strong);
    el.errorMessage.appendChild(document.createTextNode(msg.slice(i + PHRASE.length)));
  }
  showOnly("error");
}

async function loadSharedReport(id) {
  el.loadingUrl.textContent = "(shared report)";
  showOnly("loading");
  try {
    const ct = connToken();
    const res = await fetch(`${API_BASE}/api/r/${encodeURIComponent(id)}${ct ? `?ct=${encodeURIComponent(ct)}` : ""}`);
    if (res.status === 404) { el.errorMessage.textContent = "Shared report not found or expired (links live for 7 days)."; showOnly("error"); return; }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load report");
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "report_viewed",
        scan_url: data.result?.url,
      });
    } catch {}
    renderResult(data.result, { isShared: true });
  } catch (err) {
    showError(err.message || "Could not load shared report.");
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

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Belt and braces: if the user submits without ever firing
    // pointerdown / keydown / scroll (autofill, programmatic submit),
    // setupTurnstile would not have started yet. Calling it here is
    // idempotent.
    setupTurnstile();
    let raw = el.urlInput.value.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    el.scanButton.disabled = true;
    // The token is issued asynchronously and is cleared after each scan, so
    // a rescan can arrive before the widget re-issues one. Wait for it
    // instead of failing the human check outright; only error if it never
    // comes (widget broken / blocked).
    if (turnstile.active && !turnstile.token) {
      showOnly("loading");
      el.loadingUrl.textContent = raw;
      await waitForToken();
      if (!turnstile.token) {
        el.errorMessage.textContent = "Just finishing the human check. Give it a second, then try again.";
        showOnly("error");
        el.scanButton.disabled = false;
        return;
      }
    }
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
    // Fire-and-forget engagement signal so admin can see which scans
    // produced a copied share link. Never blocks the UI.
    const id = btn.dataset.id;
    if (id) {
      try {
        fetch(`${API_BASE}/api/share/copied`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }
  };
  el.copyShare.addEventListener("click", () => copy(el.copyShare));
  el.copyShare2.addEventListener("click", () => copy(el.copyShare2));
  el.retry.addEventListener("click", () => el.form.requestSubmit());
  // Both take the user back to the homepage to start a fresh scan (any
  // site). Each scan tier (Speed, Content) is then requested manually.
  el.scanAgain.addEventListener("click", backToLanding);
  el.scanAnother.addEventListener("click", backToLanding);

  // Unlock modal: close on X, on a click outside the dialog, on Escape.
  el.unlockClose.addEventListener("click", closeUnlock);
  el.unlockOverlay.addEventListener("click", (e) => {
    if (e.target === el.unlockOverlay) closeUnlock();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.unlockOverlay.hidden) closeUnlock();
  });
  el.unlockForm.addEventListener("submit", submitUnlock);

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

  // Unlock-link redemption: store the ?ct= token (and clean the URL)
  // BEFORE the report fetch below, so the very first load after clicking
  // the email link already arrives unlocked.
  captureConnToken();

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
