// Replay mode: run the REAL pipeline against frozen fixtures and assert
// the normalized result still equals the golden. This is the harness
// that proves a refactor (A1 budget, the seams) is byte-identical, and
// that ai.enabled=false stays deterministic. No network, no deploy.
// Usage: node --import ./tests/loader.mjs tests/verify.ts [slug...]
import { readFileSync, existsSync } from "node:fs";
import { performScan } from "../functions/api/scan.ts";
import { installReplayer, normalize, HARNESS_NOW } from "./fixture-fetch.ts";
import { SITES } from "./sites.ts";

const FX = new URL("./fixtures/", import.meta.url);
const GD = new URL("./golden/", import.meta.url);
const only = process.argv.slice(2);
const sites = only.length ? SITES.filter((s) => only.includes(s.slug)) : SITES;

function diff(a: any, b: any, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]))
    out.push(...diff(a?.[k], b?.[k], path ? `${path}.${k}` : k));
  return out.slice(0, 40);
}

let failed = 0;
for (const s of sites) {
  const fxp = new URL(`${s.slug}.json`, FX);
  const gdp = new URL(`${s.slug}.json`, GD);
  if (!existsSync(fxp) || !existsSync(gdp)) {
    console.log(`SKIP ${s.slug} (no fixture/golden; run record first)`);
    continue;
  }
  const fx = JSON.parse(readFileSync(fxp, "utf8"));
  const golden = JSON.parse(readFileSync(gdp, "utf8"));
  const rep = installReplayer(fx);
  let actual: any;
  try {
    actual = normalize(await performScan(s.url, {} as any, { now: HARNESS_NOW }));
  } catch (e: any) {
    console.log(`FAIL ${s.slug}: threw ${e?.message ?? e}`);
    failed++;
    continue;
  }
  const miss = rep.misses();

  if (s.mode === "invariant") {
    // Assert the properties B15 / B15-2 / B16 guarantee, without
    // requiring byte-stability (the site's sitemap is nondeterministic).
    const probs: string[] = [];
    const host = new URL(s.url).host.replace(/^www\./, "");
    const urls = actual.scannedPages.map((p: any) => p.url);
    for (const u of urls) {
      try {
        if (new URL(u).host.replace(/^www\./, "") !== host)
          probs.push(`cross-host page leaked: ${u} (B15)`);
      } catch {
        probs.push(`unparseable page url: ${u}`);
      }
    }
    if (urls.length !== new Set(urls).size)
      probs.push(`duplicate scannedPages urls (B15 dedupe)`);
    for (const p of actual.scannedPages)
      if (/\/(legal|terms|privacy|cookie-policy)(\/|$)/.test(p.url) && p.type === "about")
        probs.push(`legal/policy page typed about not boilerplate: ${p.url} (B15-2)`);
    if (typeof actual.scores.aiSeo !== "number" || actual.scores.aiSeo < 1 || actual.scores.aiSeo > 100)
      probs.push(`aiSeo score out of range: ${actual.scores.aiSeo}`);
    if (!actual.scannedPages.length) probs.push(`no pages scanned`);
    if (miss.length) probs.push(`fixture misses: ${miss.slice(0, 6).join(", ")}`);
    if (probs.length === 0) {
      console.log(`PASS ${s.slug} [invariant] (${actual.scannedPages.length} pages, aiSeo ${actual.scores.aiSeo}, host-clean, no dups)`);
    } else {
      failed++;
      console.log(`FAIL ${s.slug} [invariant]`);
      for (const p of probs) console.log(`  ${p}`);
    }
    continue;
  }

  const d = diff(golden, actual);
  if (d.length === 0 && miss.length === 0) {
    console.log(`PASS ${s.slug} (${actual.scannedPages.length} pages, aiSeo ${actual.scores.aiSeo})`);
  } else {
    failed++;
    console.log(`FAIL ${s.slug}`);
    if (miss.length) console.log(`  fixture misses: ${miss.slice(0, 8).join(", ")}`);
    for (const line of d) console.log(`  ${line}`);
  }
}
console.log(failed === 0 ? "\nALL GREEN" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
