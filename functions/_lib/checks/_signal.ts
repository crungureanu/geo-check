import type { CheckStatus, Discipline, Finding, Severity } from "../types";
import { weightOf, gateCapOf } from "../signals";

// Build a scored finding. weight + gateCap come from the signal catalog so
// they live in exactly one place. Per-page signals pass pageUrl so the id is
// `${baseId}:${url}` and dedupe aggregates them into one logical signal.
export function sig(
  baseId: string,
  o: {
    status: CheckStatus;
    severity: Severity;
    discipline: Discipline;
    title: string;
    message: string;
    fixSnippet?: string;
    attainment?: number;
    gateCap?: number;
    pageUrl?: string;
  },
): Finding {
  const f: Finding = {
    id: o.pageUrl ? `${baseId}:${o.pageUrl}` : baseId,
    status: o.status,
    severity: o.severity,
    discipline: o.discipline,
    title: o.title,
    message: o.message,
    weight: weightOf(baseId),
  };
  if (o.fixSnippet) f.fixSnippet = o.fixSnippet;
  if (o.attainment !== undefined) f.attainment = o.attainment;
  const cap = o.gateCap ?? gateCapOf(baseId);
  if (cap !== undefined) f.gateCap = cap;
  return f;
}

// Non-scoring informational note (weight 0: shown in the report, never
// counted in any score). Used for context.* and advisory-only items.
export function note(
  id: string,
  o: {
    status: CheckStatus;
    severity: Severity;
    discipline: Discipline;
    title: string;
    message: string;
    fixSnippet?: string;
  },
): Finding {
  const f: Finding = {
    id,
    status: o.status,
    severity: o.severity,
    discipline: o.discipline,
    title: o.title,
    message: o.message,
    weight: 0,
  };
  if (o.fixSnippet) f.fixSnippet = o.fixSnippet;
  return f;
}
