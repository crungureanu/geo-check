// Record mode: run the REAL pipeline against live sites once, freezing
// every HTTP interaction + the normalized result as golden.
// Usage: node --import ./tests/loader.mjs tests/record.ts [slug...]
import { mkdirSync, writeFileSync } from "node:fs";
import { performScan } from "../functions/api/scan.ts";
import { installRecorder, normalize, HARNESS_NOW } from "./fixture-fetch.ts";
import { SITES } from "./sites.ts";

const FX = new URL("./fixtures/", import.meta.url);
const GD = new URL("./golden/", import.meta.url);
mkdirSync(FX, { recursive: true });
mkdirSync(GD, { recursive: true });

const only = process.argv.slice(2);
const sites = only.length ? SITES.filter((s) => only.includes(s.slug)) : SITES;

for (const s of sites) {
  process.stdout.write(`recording ${s.slug} (${s.url}) ... `);
  try {
    const rec = installRecorder();
    const result = await performScan(s.url, {} as any, { now: HARNESS_NOW });
    writeFileSync(new URL(`${s.slug}.json`, FX), JSON.stringify(rec.dump()));
    writeFileSync(
      new URL(`${s.slug}.json`, GD),
      JSON.stringify(normalize(result), null, 2),
    );
    const r: any = result;
    console.log(
      `ok: ${r.scannedPages.length} pages, aiSeo ${r.scores.aiSeo}, ${r.findings.length} findings`,
    );
  } catch (e: any) {
    console.log(`FAILED: ${e?.message ?? e}`);
  }
}
