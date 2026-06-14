// Regold mode: replay EXISTING fixtures through the current pipeline and
// rewrite the goldens. Use after a deliberate, reviewed output-shape change
// (run verify first and inspect the diffs; this freezes whatever the code
// now produces). No network. Skips invariant-mode sites (no golden).
// Usage: node --import ./tests/register.mjs tests/regold.ts [slug...]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { performScan } from "../functions/api/scan.ts";
import { installReplayer, normalize, HARNESS_NOW } from "./fixture-fetch.ts";
import { SITES } from "./sites.ts";

const FX = new URL("./fixtures/", import.meta.url);
const GD = new URL("./golden/", import.meta.url);
const only = process.argv.slice(2);
const sites = only.length ? SITES.filter((s) => only.includes(s.slug)) : SITES;

for (const s of sites) {
  if (s.mode === "invariant") {
    console.log(`SKIP ${s.slug} (invariant mode, no golden)`);
    continue;
  }
  const fxp = new URL(`${s.slug}.json`, FX);
  if (!existsSync(fxp)) {
    console.log(`SKIP ${s.slug} (no fixture)`);
    continue;
  }
  const fx = JSON.parse(readFileSync(fxp, "utf8"));
  installReplayer(fx);
  const result = await performScan(s.url, {} as any, { now: HARNESS_NOW });
  writeFileSync(new URL(`${s.slug}.json`, GD), JSON.stringify(normalize(result), null, 2));
  const r: any = result;
  console.log(
    `regold ${s.slug}: aiSeo ${r.scores.aiSeo}, classic ${r.scores.classicSeo}, content ${r.scores.content ?? "n/a"}, ${r.findings.length} findings, ${r.contentFindings?.length ?? 0} content findings`,
  );
}
