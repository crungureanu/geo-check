"use strict";

// Same-origin Pages Functions: /api/scan and /api/r/:id are on the same host as this page.
const API_BASE = "";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const elements = {
  form: $("#scan-form"),
  urlInput: $("#scan-url"),
  scanButton: $("#scan-button"),
  loading: $("#loading"),
  loadingUrl: $("#loading-url"),
  results: $("#results"),
  resultsMeta: $("#results-meta"),
  error: $("#error"),
  errorMessage: $("#error-message"),
  retryButton: $("#retry"),
  scoreAi: $("#score-ai"),
  scoreClassic: $("#score-classic"),
  buckets: {
    blocking: { wrap: $("#bucket-blocking"), list: $("#bucket-blocking ul"), count: $("#bucket-blocking .bucket-count") },
    important: { wrap: $("#bucket-important"), list: $("#bucket-important ul"), count: $("#bucket-important .bucket-count") },
    nice: { wrap: $("#bucket-nice"), list: $("#bucket-nice ul"), count: $("#bucket-nice .bucket-count") },
  },
  allClear: $("#all-clear"),
  notesSection: $("#notes-section"),
  notesSummary: $("#notes-summary"),
  notesList: $("#notes-list"),
  deepLinks: $("#deep-links-row"),
  pagesScannedSummary: $("#pages-scanned-summary"),
  pagesScannedList: $("#pages-scanned-list"),
  copyShare: $("#copy-share"),
  scanAnother: $("#scan-another"),
  shareInfo: $("#share-info"),
  template: $("#finding-template"),
};

function showOnly(which) {
  for (const id of ["loading", "results", "error"]) {
    elements[id].hidden = id !== which;
  }
}

function setLoading(url) {
  elements.loadingUrl.textContent = url;
  showOnly("loading");
}

function scoreBand(score) {
  if (score >= 80) return "good";
  if (score >= 55) return "mid";
  return "poor";
}

function disciplineLabel(d) {
  if (d === "ai-seo") return "AI SEO";
  if (d === "classic-seo") return "Classic SEO";
  return "AI SEO + Classic SEO";
}

function renderFinding(finding) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  const status = node.querySelector(".finding-status");
  status.textContent = finding.status;
  status.dataset.status = finding.status;
  node.querySelector(".finding-title").textContent = finding.title;
  node.querySelector(".finding-disc").textContent = disciplineLabel(finding.discipline);
  node.querySelector(".finding-message").textContent = finding.message;

  const fix = node.querySelector(".finding-fix");
  if (finding.fixSnippet) {
    node.querySelector(".fix-snippet").textContent = finding.fixSnippet;
    fix.hidden = false;
  }

  const affected = node.querySelector(".finding-affected");
  if (finding.affectedPages && finding.affectedPages.length) {
    const pages = finding.affectedPages.length === 1
      ? `Affects 1 page: ${finding.affectedPages[0]}`
      : `Affects ${finding.affectedPages.length} pages: ${finding.affectedPages.slice(0, 3).join(", ")}${finding.affectedPages.length > 3 ? "…" : ""}`;
    affected.textContent = pages;
    affected.hidden = false;
  }
  return node;
}

function renderResult(result, opts = {}) {
  const { isShared = false } = opts;

  elements.resultsMeta.textContent = `Scanned ${result.url} · ${new Date(result.scannedAt).toLocaleString()}${isShared ? " · viewing a shared report" : ""}`;

  elements.scoreAi.textContent = result.scores.aiSeo;
  elements.scoreClassic.textContent = result.scores.classicSeo;
  elements.scoreAi.closest(".score-card").dataset.scoreBand = scoreBand(result.scores.aiSeo);
  elements.scoreClassic.closest(".score-card").dataset.scoreBand = scoreBand(result.scores.classicSeo);

  const buckets = { blocking: [], important: [], nice: [] };
  const notes = [];
  for (const f of result.findings) {
    if (f.status === "pass") {
      // Pass findings that carry a message are informational notes (e.g.
      // "outbound links present, authority not verified"). Surface them
      // separately so they don't read as problems and don't affect the score.
      if (f.message) notes.push(f);
      continue;
    }
    buckets[f.severity].push(f);
  }

  let total = 0;
  for (const sev of ["blocking", "important", "nice"]) {
    const ui = elements.buckets[sev];
    ui.list.innerHTML = "";
    if (buckets[sev].length === 0) {
      ui.wrap.hidden = true;
      continue;
    }
    ui.wrap.hidden = false;
    ui.count.textContent = `(${buckets[sev].length})`;
    for (const f of buckets[sev]) ui.list.appendChild(renderFinding(f));
    total += buckets[sev].length;
  }
  elements.allClear.hidden = total > 0;

  elements.notesList.innerHTML = "";
  if (notes.length) {
    for (const n of notes) elements.notesList.appendChild(renderFinding(n));
    elements.notesSummary.textContent = `Notes (not scored) (${notes.length})`;
    elements.notesSection.hidden = false;
  } else {
    elements.notesSection.hidden = true;
  }

  elements.deepLinks.innerHTML = "";
  for (const link of result.deepLinks || []) {
    const a = document.createElement("a");
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link.label;
    elements.deepLinks.appendChild(a);
  }

  elements.pagesScannedList.innerHTML = "";
  const yourUrl = result.url;
  for (const page of result.scannedPages) {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = "type-tag";
    tag.textContent = page.type;
    const link = document.createElement("a");
    link.href = page.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = page.url;
    li.appendChild(tag);
    li.appendChild(link);
    if (page.url === yourUrl) {
      const you = document.createElement("span");
      you.className = "you-tag";
      you.textContent = "← you pasted this";
      li.appendChild(you);
    }
    elements.pagesScannedList.appendChild(li);
  }
  elements.pagesScannedSummary.textContent = `Pages we scanned (${result.scannedPages.length})`;

  if (result.id && !isShared) {
    const url = `${window.location.origin}/r/${result.id}`;
    elements.shareInfo.textContent = `Share link: ${url} (active for 7 days)`;
    elements.copyShare.hidden = false;
    elements.copyShare.dataset.url = url;
  } else if (isShared) {
    elements.shareInfo.textContent = "You're viewing a shared report.";
    elements.copyShare.hidden = true;
  } else {
    elements.shareInfo.textContent = "";
    elements.copyShare.hidden = true;
  }

  showOnly("results");
}

async function runScan(targetUrl) {
  setLoading(targetUrl);
  try {
    const res = await fetch(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    renderResult(data.result);
  } catch (err) {
    elements.errorMessage.textContent = err.message || "Something went wrong. Try again.";
    showOnly("error");
  } finally {
    elements.scanButton.disabled = false;
  }
}

async function loadSharedReport(id) {
  setLoading("(shared report)");
  try {
    const res = await fetch(`${API_BASE}/api/r/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      elements.errorMessage.textContent = "Shared report not found or expired (links live for 7 days).";
      showOnly("error");
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load report");
    renderResult(data.result, { isShared: true });
  } catch (err) {
    elements.errorMessage.textContent = err.message || "Could not load shared report.";
    showOnly("error");
  }
}

function init() {
  elements.form.addEventListener("submit", (e) => {
    e.preventDefault();
    let raw = elements.urlInput.value.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    elements.scanButton.disabled = true;
    runScan(raw);
  });

  elements.retryButton.addEventListener("click", () => {
    elements.form.requestSubmit();
  });

  elements.scanAnother.addEventListener("click", () => {
    elements.urlInput.value = "";
    elements.urlInput.focus();
    for (const id of ["loading", "results", "error"]) elements[id].hidden = true;
  });

  elements.copyShare.addEventListener("click", async () => {
    const url = elements.copyShare.dataset.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      elements.shareInfo.textContent = "Link copied to clipboard.";
    } catch {
      elements.shareInfo.textContent = `Copy this link: ${url}`;
    }
  });

  const shareMatch = window.location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  if (shareMatch) loadSharedReport(shareMatch[1]);
}

init();
