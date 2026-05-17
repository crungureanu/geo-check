// A1 truncation case: with a deliberately tiny subrequest budget the
// scan must DEGRADE GRACEFULLY, not fail. Asserts: it still returns a
// result (no false "Could not reach" throw), the truncation note is
// present, NO phantom fetch.failed findings for budget-skipped pages,
// host-clean, home page still scored.
// Usage: node --import ./tests/register.mjs tests/verify-truncation.ts
import { readFileSync, existsSync } from "node:fs";
import { performScan } from "../functions/api/scan.ts";
import { installReplayer } from "./fixture-fetch.ts";

const slug = "selectcarleasing"; // 10-page site, exercises truncation
const fxp = new URL(`./fixtures/${slug}.json`, import.meta.url);
if (!existsSync(fxp)) {
  console.log(`SKIP (no fixture; run record first)`);
  process.exit(0);
}
const fx = JSON.parse(readFileSync(fxp, "utf8"));
installReplayer(fx);

const probs: string[] = [];
let result: any;
try {
  // Tiny budget: enough for discovery + home + a couple pages, then cut.
  result = await performScan("https://www.selectcarleasing.co.uk", {
    SCAN_SUBREQUEST_BUDGET: "6",
  } as any);
} catch (e: any) {
  console.log(`FAIL: budget truncation threw instead of degrading: ${e?.message ?? e}`);
  process.exit(1);
}

const f = result.findings;
const note = f.find((x: any) => x.id === "context.pages-truncated");
if (!note) probs.push("missing context.pages-truncated note");
if (note && note.status !== "pass") probs.push(`note status ${note.status} (must be pass => 0 score impact)`);
const fetchFailed = f.filter((x: any) => x.id.startsWith("fetch.failed"));
if (fetchFailed.length) probs.push(`phantom fetch.failed emitted for skipped pages: ${fetchFailed.length}`);
if (!result.scannedPages.length) probs.push("no pages scored (over-truncated / false unreachable)");
const host = "selectcarleasing.co.uk";
for (const p of result.scannedPages) {
  try {
    if (new URL(p.url).host.replace(/^www\./, "") !== host) probs.push(`cross-host page: ${p.url}`);
  } catch {
    probs.push(`bad url ${p.url}`);
  }
}
const hasHome = result.scannedPages.some((p: any) => p.type === "home");
if (!hasHome) probs.push("home page missing (budget starved it; must be fetched first)");
if (typeof result.scores.aiSeo !== "number" || result.scores.aiSeo < 1)
  probs.push(`aiSeo score invalid: ${result.scores.aiSeo}`);

if (probs.length === 0) {
  console.log(
    `PASS truncation (scored ${result.scannedPages.length} pages, aiSeo ${result.scores.aiSeo}, note present, no phantom fetch.failed, home kept)`,
  );
  process.exit(0);
} else {
  console.log("FAIL truncation");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
