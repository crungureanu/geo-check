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

if (probs.length === 0) {
  console.log(`PASS impact-points (${files.length} goldens: pillars match discipline, pass=0, sums == score gap)`);
  process.exit(0);
} else {
  console.log("FAIL impact-points");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
