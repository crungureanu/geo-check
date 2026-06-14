// Record/replay shim for globalThis.fetch. The whole pipeline's only
// external input is HTTP (fetcher.ts, page-selector child sitemaps,
// pagespeed). Freezing fetch makes performScan fully deterministic
// (selectPages is pure given fixed input), so findings/scores become
// byte-comparable golden output. Production code is NOT modified.

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";

type Rec = { status: number; headers: [string, string][]; bodyB64: string };
type Fixture = Record<string, Rec>; // key = `${METHOD} ${url}`

function key(input: any, init: any): string {
  const url = typeof input === "string" ? input : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  return `${method} ${url}`;
}

// This machine's Node TLS cannot verify some chains (UNABLE_TO_VERIFY_
// LEAF_SIGNATURE); curl can (--ssl-no-revoke / system store). Record
// mode therefore uses curl as the transport so the REAL fetcher.ts
// logic (manual redirect loop, Accept/UA headers, meta-refresh) still
// drives every hop. Replay mode uses only synthetic node Response (no
// network), so verification is unaffected by the TLS quirk.
function curlFetch(input: any, init: any): {
  status: number;
  headers: [string, string][];
  bodyB64: string;
} {
  const url = typeof input === "string" ? input : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const hdrs = (init?.headers ?? {}) as Record<string, string>;
  const follow = init?.redirect === "follow";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bodyFile = join(tmpdir(), `xeo-b-${stamp}`);
  const hdrFile = join(tmpdir(), `xeo-h-${stamp}`);
  const args = [
    "-s", "--ssl-no-revoke", "-m", "25",
    "-X", method,
    "-A", hdrs["User-Agent"] ?? "XEOScanBot",
    "-H", `Accept: ${hdrs["Accept"] ?? "*/*"}`,
    "-D", hdrFile, "-o", bodyFile,
    "-w", "%{http_code}",
  ];
  if (method === "HEAD") args.push("-I");
  if (follow) args.push("-L");
  args.push(url);
  let status = 0;
  let headers: [string, string][] = [];
  let bodyB64 = "";
  try {
    const code = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
    status = parseInt(code, 10) || 0;
    const rawH = readFileSync(hdrFile, "utf8");
    // With -L there are multiple header blocks; keep the LAST (final response).
    const blocks = rawH.split(/\r?\n\r?\n/).filter((b: string) => b.trim());
    const last = blocks[blocks.length - 1] ?? "";
    for (const line of last.split(/\r?\n/).slice(1)) {
      const i = line.indexOf(":");
      if (i > 0) headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
    if (method !== "HEAD") {
      const buf = readFileSync(bodyFile);
      bodyB64 = Buffer.from(buf.subarray(0, 3_000_000)).toString("base64");
    }
  } catch {
    status = 0;
  } finally {
    try { rmSync(bodyFile); } catch {}
    try { rmSync(hdrFile); } catch {}
  }
  return { status, headers, bodyB64 };
}

export function installRecorder(): { dump(): Fixture } {
  const out: Fixture = {};
  globalThis.fetch = (async (input: any, init: any) => {
    const rec = curlFetch(input, init);
    out[key(input, init)] = rec;
    return new Response(rec.bodyB64 ? Buffer.from(rec.bodyB64, "base64") : null, {
      status: rec.status || 599,
      headers: rec.headers,
    });
  }) as typeof fetch;
  return { dump: () => out };
}

export function installReplayer(fx: Fixture): { misses(): string[] } {
  const misses: string[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const k = key(input, init);
    const rec = fx[k];
    if (!rec) {
      misses.push(k);
      return new Response("", { status: 599 });
    }
    return new Response(rec.bodyB64 ? Buffer.from(rec.bodyB64, "base64") : null, {
      status: rec.status,
      headers: rec.headers,
    });
  }) as typeof fetch;
  return { misses: () => misses };
}

// Frozen "now" for the offline harness. Time-dependent checks (stale-year,
// recency) read CheckContext.now; freezing it here keeps goldens stable
// across calendar years instead of drifting every January. Pass this as
// performScan's `now` opt in every golden-comparing harness (record, verify,
// regold). Bump only when deliberately re-baselining against a later date.
export const HARNESS_NOW = Date.UTC(2026, 5, 14); // 2026-06-14

// Drop fields that legitimately vary run to run (clock, random share id,
// fixed ttl) so comparison is about scanner behaviour only.
export function normalize(result: any): any {
  const r = JSON.parse(JSON.stringify(result));
  delete r.id;
  delete r.scannedAt;
  delete r.ttl;
  return r;
}
