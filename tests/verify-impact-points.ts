// Pillar-attributed impact points: invariant guard over the frozen goldens.
// attachImpactPoints tags each scored finding with how many points fixing it
// recovers in its TRUE pillar, normalised so a pillar's findings sum to
// ~(100 - that pillar's score). These invariants are what make the report's
// "recovers up to N Content points" honest, so lock them down independently
// of any one site's numbers.
// Usage: node --import ./tests/register.mjs tests/verify-impact-points.ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SITES } from "./sites.ts";
import { computeScores, attachImpactPoints } from "../functions/_lib/scoring.ts";

// Invariant-mode sites have no maintained golden (regold skips them), so their
// stale golden files predate pillarPoints; only check strict-mode goldens.
const STRICT = new Set(SITES.filter((s) => s.mode === "strict").map((s) => s.slug));
const GD = fileURLToPath(new URL("./golden/", import.meta.url));
const files = readdirSync(GD).filter((f) => f.endsWith(".json") && STRICT.has(f.replace(/\.json$/, "")));

const probs: string[] = [];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// Which pillar entries a finding of this discipline must carry.
const EXPECT: Record<string, string[]> = {
  "ai-seo": ["ai"],
  "classic-seo": ["classic"],
  both: ["ai", "classic"],
};

for (const file of files) {
  const g = JSON.parse(readFileSync(`${GD}${file}`, "utf8"));
  const tag = file.replace(/\.json$/, "");
  const mains: any[] = g.findings ?? [];
  const contents: any[] = g.contentFindings ?? [];

  const ppOf = (f: any): { pillar: string; points: number }[] | undefined => f.pillarPoints;

  // --- per-finding shape invariants (main findings) ---
  for (const f of mains) {
    const w = f.weight ?? 0;
    const pp = ppOf(f);
    if (w <= 0) {
      if (pp) probs.push(`${tag}: weight-0 finding ${f.id} must NOT carry pillarPoints`);
      continue;
    }
    if (!pp || pp.length === 0) {
      probs.push(`${tag}: scored finding ${f.id} (w=${w}) is missing pillarPoints`);
      continue;
    }
    const want = EXPECT[f.discipline];
    if (!want) {
      probs.push(`${tag}: ${f.id} has unexpected discipline ${f.discipline}`);
    } else {
      const got = pp.map((e) => e.pillar).sort();
      if (got.join(",") !== [...want].sort().join(",")) {
        probs.push(`${tag}: ${f.id} (${f.discipline}) pillars [${got}] != expected [${want}]`);
      }
    }
    // A passed signal has nothing left to recover.
    if (f.status === "pass") {
      for (const e of pp) if (e.points !== 0) probs.push(`${tag}: passed ${f.id} has non-zero ${e.pillar} points ${e.points}`);
    }
    for (const e of pp) if (e.points < 0) probs.push(`${tag}: ${f.id} negative ${e.pillar} points ${e.points}`);
  }

  // --- content findings: single "content" entry ---
  for (const f of contents) {
    const w = f.weight ?? 0;
    const pp = ppOf(f);
    if (w <= 0) {
      if (pp) probs.push(`${tag}: weight-0 content finding ${f.id} must NOT carry pillarPoints`);
      continue;
    }
    if (!pp || pp.length !== 1 || pp[0].pillar !== "content") {
      probs.push(`${tag}: content finding ${f.id} must carry exactly one "content" entry`);
      continue;
    }
    if (f.status === "pass" && pp[0].points !== 0) probs.push(`${tag}: passed content ${f.id} has non-zero points ${pp[0].points}`);
  }

  // --- per-pillar sum ~= (100 - score) ---
  const sumPillar = (findings: any[], pillar: string) => {
    let sum = 0, n = 0;
    for (const f of findings) for (const e of ppOf(f) ?? []) if (e.pillar === pillar) { sum += e.points; n++; }
    return { sum, n };
  };
  const checkSum = (findings: any[], pillar: string, score: number | undefined) => {
    if (typeof score !== "number") return; // pillar not scored on this report
    const { sum, n } = sumPillar(findings, pillar);
    if (n === 0) return; // no applicable findings => score is 100, gap 0
    const gap = 100 - score;
    const tol = 0.05 * n + 1e-6; // each point rounded to 0.1
    if (!near(sum, gap, tol)) probs.push(`${tag}: ${pillar} points sum ${sum.toFixed(2)} != gap ${gap} (n=${n}, tol=${tol.toFixed(2)})`);
  };
  checkSum(mains, "ai", g.scores?.aiSeo);
  checkSum(mains, "classic", g.scores?.classicSeo);
  checkSum(contents, "content", g.scores?.content);
}

// --- synthetic gate-cap case (H1): the goldens have no active gate cap, so
// exercise it directly. A blocked AI crawler caps aiSeo at 25 while raw
// attainment is ~52. The cap-release must land on the GATE finding, not be
// smeared across big-weight non-gate findings (the old bug made Structured
// data claim ~33 points it could not move while the gate still failed). ---
{
  const mk = (id: string, weight: number, status: string, attainment: number, gateCap?: number): any => ({
    id, status, severity: "nice", discipline: "ai-seo", title: id, message: "", weight, attainment,
    ...(gateCap !== undefined ? { gateCap } : {}),
  });
  const F: any[] = [
    mk("robots.ai-access", 3, "fail", 0, 25), // the binding failed gate
    mk("schema.present", 12, "fail", 0), // big-weight non-gate (was inflated)
    mk("extract.content", 12, "fail", 0),
    mk("cite.author", 6, "pass", 1),
    mk("cite.date", 5, "pass", 1),
    mk("schema.org", 3, "pass", 1),
    mk("extract.landmark", 3, "pass", 1),
    mk("answer.lists", 3, "pass", 1),
    mk("extract.image-alt", 3, "pass", 1),
    mk("cite.recency", 3, "pass", 1),
    mk("cite.outbound", 3, "pass", 1),
  ];
  const sc = computeScores(F);
  attachImpactPoints(sc, F, []);
  const ai = (id: string) => {
    const f = F.find((x) => x.id === id);
    const e = (f.pillarPoints ?? []).find((p: any) => p.pillar === "ai");
    return e ? e.points : 0;
  };
  if (sc.aiSeo !== 25) probs.push(`gatecap: expected aiSeo capped to 25, got ${sc.aiSeo}`);
  const gate = ai("robots.ai-access");
  const schema = ai("schema.present");
  const sum = F.reduce((acc, f) => acc + ((f.pillarPoints ?? []).find((p: any) => p.pillar === "ai")?.points ?? 0), 0);
  const gap = 100 - sc.aiSeo;
  if (Math.abs(sum - gap) > 1.0) probs.push(`gatecap: ai points sum ${sum.toFixed(2)} != gap ${gap}`);
  // The gate (weight 3) must outrank the 4x-heavier non-gate (weight 12),
  // because the cap-release is attributed to it. This is the H1 inversion.
  if (!(gate > schema)) probs.push(`gatecap: gate points ${gate} should exceed non-gate schema ${schema}`);
  // The gate must clearly carry the cap-release, not just its tiny w*(1-a) share.
  if (gate < 25) probs.push(`gatecap: gate points ${gate} too low - cap-release not attributed`);
  // The non-gate must NOT be inflated by the cap-release: its share is bounded
  // by the attainment gap, well under the old full-gap*w/den (~33).
  if (schema > 28) probs.push(`gatecap: non-gate schema ${schema} looks inflated by cap-release`);
  // Passing findings recover nothing.
  if (ai("cite.author") !== 0) probs.push(`gatecap: passing finding has non-zero points ${ai("cite.author")}`);
}

if (probs.length === 0) {
  console.log(`PASS impact-points (${files.length} goldens + gate-cap synthetic: pillars match discipline, pass=0, sums == score gap, cap-release on gate)`);
  process.exit(0);
} else {
  console.log("FAIL impact-points");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
