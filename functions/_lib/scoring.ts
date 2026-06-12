import type { Finding, ScanScores } from "./types";
import { SIGNALS } from "./signals";

// Worst-first ordering. A signal that fails on one page and passes on
// another displays as the worst case (fail), with the per-page attainment
// still averaged into the score.
const STATUS_ORDER: Record<Finding["status"], number> = {
  fail: 0,
  warn: 1,
  partial: 2,
  pass: 3,
};
const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  blocking: 0,
  important: 1,
  nice: 2,
};

// Attainment a finding contributes when it does not carry an explicit one.
function statusAttainment(s: Finding["status"]): number {
  return s === "pass" ? 1 : s === "partial" ? 0.5 : 0; // warn/fail = 0
}
function effAttainment(f: Finding): number {
  const a = f.attainment ?? statusAttainment(f.status);
  return Math.max(0, Math.min(1, a));
}

// Collapse per-page findings into one logical signal. Group by baseId (the
// id before the first ':'); the suffix, when present, is the page URL. The
// representative (shown in the report) is the worst-status finding; its
// aggregated attainment is the mean across all pages the signal applied to.
export function dedupeFindings(findings: Finding[]): Finding[] {
  const grouped = new Map<
    string,
    {
      rep: Finding;
      atts: number[];
      // Per-page status, so the representative can list ONLY the pages at
      // its own (worst) severity, not lump "missing" and "suboptimal"
      // pages under a "No X" headline (that overstated the problem).
      pages: { url: string; status: Finding["status"] }[];
      gateCap?: number;
    }
  >();

  for (const f of findings) {
    const colonIdx = f.id.indexOf(":");
    const baseId = colonIdx > 0 ? f.id.slice(0, colonIdx) : f.id;
    const affectedFromId = colonIdx > 0 ? f.id.slice(colonIdx + 1) : null;
    const att = effAttainment(f);

    const g = grouped.get(baseId);
    if (!g) {
      grouped.set(baseId, {
        rep: { ...f, id: baseId },
        atts: [att],
        pages: affectedFromId ? [{ url: affectedFromId, status: f.status }] : [],
        gateCap: f.gateCap,
      });
      continue;
    }
    g.atts.push(att);
    if (affectedFromId && !g.pages.some((p) => p.url === affectedFromId)) {
      g.pages.push({ url: affectedFromId, status: f.status });
    }
    if (f.gateCap !== undefined) {
      g.gateCap = g.gateCap === undefined ? f.gateCap : Math.min(g.gateCap, f.gateCap);
    }
    if (STATUS_ORDER[f.status] < STATUS_ORDER[g.rep.status]) {
      g.rep = { ...f, id: baseId };
    }
  }

  const out: Finding[] = [];
  for (const g of grouped.values()) {
    const mean = g.atts.reduce((a, b) => a + b, 0) / g.atts.length;
    const rep = g.rep;
    rep.attainment = mean;
    // Pages at the representative's own severity (e.g. truly "missing").
    const atRepStatus = g.pages
      .filter((p) => p.status === rep.status && p.status !== "pass")
      .map((p) => p.url);
    // Other pages with a weaker form of the same issue (e.g. present but
    // suboptimal). Surfaced as an honest count, not mislabelled.
    const weaker = g.pages.filter(
      (p) => p.status !== "pass" && p.status !== rep.status,
    ).length;
    if (atRepStatus.length) rep.affectedPages = atRepStatus;
    if (weaker > 0) {
      rep.message +=
        ` (Plus ${weaker} more page${weaker === 1 ? "" : "s"} with a milder version of this issue, counted proportionally in the score.)`;
    }
    if (g.gateCap !== undefined) rep.gateCap = g.gateCap;
    else delete rep.gateCap;
    out.push(rep);
  }
  return out;
}

// Weighted attainment over the APPLICABLE signals only, then clamp by any
// failed critical gate. A signal is applicable iff a (deduped) finding for
// it exists with a positive weight; signals never emitted are simply absent
// from both numerator and denominator.
export function computeScores(deduped: Finding[]): ScanScores {
  let aiNum = 0, aiDen = 0, clNum = 0, clDen = 0;
  let aiCap = 100, clCap = 100;

  for (const f of deduped) {
    const w = f.weight ?? 0;
    if (w <= 0) continue; // context/* and fetch.* notes never score
    const a = Math.max(0, Math.min(1, f.attainment ?? statusAttainment(f.status)));
    const inAi = f.discipline === "ai-seo" || f.discipline === "both";
    const inCl = f.discipline === "classic-seo" || f.discipline === "both";
    if (inAi) { aiNum += w * a; aiDen += w; }
    if (inCl) { clNum += w * a; clDen += w; }
    // A gate caps the discipline ONLY when it actually FAILED. partial/warn
    // states (e.g. no robots.txt = open access, attainment 0.7) carry their
    // weighted penalty but must not trigger the hard cap.
    if (f.gateCap !== undefined && f.status === "fail" && a < 1) {
      if (inAi) aiCap = Math.min(aiCap, f.gateCap);
      if (inCl) clCap = Math.min(clCap, f.gateCap);
    }
  }

  const raw = (num: number, den: number) =>
    den > 0 ? Math.round((100 * num) / den) : 100;
  const clamp = (v: number) => Math.max(1, Math.min(100, v));

  return {
    aiSeo: clamp(Math.min(raw(aiNum, aiDen), aiCap)),
    classicSeo: clamp(Math.min(raw(clNum, clDen), clCap)),
  };
}

// Bar-3 (Content depth) score: weighted attainment over the applicable
// content signals, same model as computeScores but a single number and no
// gate caps (content quality never hard-caps; access gates live in bar 1).
// Returns null when nothing applied (e.g. every page failed to fetch):
// callers then omit scores.content entirely.
export function computeContentScore(deduped: Finding[]): number | null {
  let num = 0, den = 0;
  for (const f of deduped) {
    const w = f.weight ?? 0;
    if (w <= 0) continue;
    const a = Math.max(0, Math.min(1, f.attainment ?? statusAttainment(f.status)));
    num += w * a;
    den += w;
  }
  if (den <= 0) return null;
  return Math.max(1, Math.min(100, Math.round((100 * num) / den)));
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    const st = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (st !== 0) return st;
    return a.id.localeCompare(b.id);
  });
}

// Signals in the catalog that never produced a finding for this scan: not
// expected of this site (no products -> Product schema; no Q&A -> FAQ; no
// PageSpeed key offline -> Core Web Vitals). Listed so the denominator is
// transparent.
export function computeNotApplicable(
  deduped: Finding[],
): { id: string; title: string; discipline: Finding["discipline"] }[] {
  const present = new Set(deduped.map((f) => f.id));
  return SIGNALS.filter((s) => !present.has(s.id)).map((s) => ({
    id: s.id,
    title: s.title,
    discipline: s.discipline,
  }));
}
