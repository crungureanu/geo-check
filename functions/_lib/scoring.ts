import type { Finding, ScanScores } from "./types";

const SEVERITY_WEIGHT: Record<Finding["severity"], { fail: number; warn: number }> = {
  blocking: { fail: 25, warn: 10 },
  important: { fail: 10, warn: 5 },
  nice: { fail: 3, warn: 1 },
};

export function computeScores(findings: Finding[]): ScanScores {
  let ai = 100;
  let classic = 100;

  for (const f of findings) {
    if (f.status === "pass") continue;
    const w = SEVERITY_WEIGHT[f.severity];
    const penalty = f.status === "fail" ? w.fail : w.warn;
    if (f.discipline === "ai-seo" || f.discipline === "both") ai -= penalty;
    if (f.discipline === "classic-seo" || f.discipline === "both") classic -= penalty;
  }

  return {
    aiSeo: Math.max(0, Math.min(100, Math.round(ai))),
    classicSeo: Math.max(0, Math.min(100, Math.round(classic))),
  };
}

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  blocking: 0,
  important: 1,
  nice: 2,
};
const STATUS_ORDER: Record<Finding["status"], number> = {
  fail: 0,
  warn: 1,
  pass: 2,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    const st = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (st !== 0) return st;
    return a.id.localeCompare(b.id);
  });
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const grouped = new Map<string, Finding>();
  for (const f of findings) {
    const colonIdx = f.id.indexOf(":");
    const baseId = colonIdx > 0 ? f.id.slice(0, colonIdx) : f.id;
    const affectedFromId = colonIdx > 0 ? f.id.slice(colonIdx + 1) : null;

    const existing = grouped.get(baseId);
    if (existing) {
      if (affectedFromId) {
        existing.affectedPages = existing.affectedPages ?? [];
        if (!existing.affectedPages.includes(affectedFromId)) {
          existing.affectedPages.push(affectedFromId);
        }
      }
      // Promote status to the more severe one
      if (STATUS_ORDER[f.status] < STATUS_ORDER[existing.status]) {
        existing.status = f.status;
      }
    } else {
      const cleaned: Finding = { ...f, id: baseId };
      if (affectedFromId) cleaned.affectedPages = [affectedFromId];
      grouped.set(baseId, cleaned);
    }
  }
  return Array.from(grouped.values());
}
