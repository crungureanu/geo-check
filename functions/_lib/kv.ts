import type { ScanResult } from "./types";
import { SCHEMA_VERSION } from "./types";

const TTL_SECONDS = 7 * 24 * 60 * 60;

export function generateShareId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

export async function saveScan(
  kv: KVNamespace | undefined,
  result: ScanResult,
): Promise<string | null> {
  if (!kv) return null;
  const id = generateShareId();
  const payload: ScanResult = {
    ...result,
    id,
    ttl: TTL_SECONDS,
    schemaVersion: SCHEMA_VERSION,
  };
  await kv.put(id, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  return id;
}

// Overwrite an existing stored report in place (same id), used by the
// phase-2 /api/speed endpoint to merge Core Web Vitals into a report the
// user already has. TTL is reset to the full window; a speed run happens
// minutes after the scan so this still honours the ~7-day retention.
export async function updateScan(
  kv: KVNamespace | undefined,
  id: string,
  result: ScanResult,
): Promise<boolean> {
  if (!kv) return false;
  const payload: ScanResult = {
    ...result,
    id,
    ttl: TTL_SECONDS,
    schemaVersion: SCHEMA_VERSION,
  };
  await kv.put(id, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  return true;
}

// --- scan log -------------------------------------------------------
// Lightweight audit trail: one tiny KV entry per completed scan so the
// operator can see what was scanned and when. Keyed with a
// reverse-sortable timestamp so a prefix list returns newest-first.
// Kept 90 days then auto-expires. Fail-soft: a logging error must never
// break a scan, so callers wrap this in try/catch and ignore failures.
const SCANLOG_TTL = 90 * 24 * 60 * 60;
const SCANLOG_PREFIX = "scanlog:";

export interface ScanLogEntry {
  url: string;
  at: string;
  pages?: number;
  ai?: number;
  classic?: number;
  // Share id, used to join an admin row to its phase-2 speed-log record
  // (speedlog:${id}). Optional so entries written before this field
  // existed still parse cleanly; they just cannot resolve a speed score.
  id?: string;
}

export async function logScan(
  kv: KVNamespace | undefined,
  entry: ScanLogEntry,
): Promise<void> {
  if (!kv) return;
  // 1e15 - now keeps keys lexicographically ascending = chronologically
  // descending, so list() yields most-recent first without sorting.
  const rev = (1e15 - Date.now()).toString().padStart(16, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  await kv.put(`${SCANLOG_PREFIX}${rev}:${rand}`, JSON.stringify(entry), {
    expirationTtl: SCANLOG_TTL,
  });
}

export async function listScanLog(
  kv: KVNamespace | undefined,
  limit = 500,
): Promise<ScanLogEntry[]> {
  if (!kv) return [];
  const out: ScanLogEntry[] = [];
  let cursor: string | undefined;
  while (out.length < limit) {
    const res: any = await kv.list({
      prefix: SCANLOG_PREFIX,
      limit: Math.min(1000, limit - out.length),
      cursor,
    });
    for (const k of res.keys) {
      const raw = await kv.get(k.name);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as ScanLogEntry);
        } catch {}
      }
      if (out.length >= limit) break;
    }
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

// --- speed log ------------------------------------------------------
// Separate KV record per share id holding just the Lighthouse mobile +
// desktop performance scores. Independent of the 7-day share report so
// the 90-day admin "Websites scanned" view can still show speed scores
// for older rows whose user-facing share link has already expired.
// Same fail-soft contract as logScan: a logging error must never break
// a successful speed run for the user.
const SPEEDLOG_TTL = 90 * 24 * 60 * 60;
const SPEEDLOG_PREFIX = "speedlog:";

export interface SpeedLogEntry {
  mobile: number | null;
  desktop: number | null;
}

export async function logSpeedScores(
  kv: KVNamespace | undefined,
  id: string,
  entry: SpeedLogEntry,
): Promise<void> {
  if (!kv || !id) return;
  await kv.put(`${SPEEDLOG_PREFIX}${id}`, JSON.stringify(entry), {
    expirationTtl: SPEEDLOG_TTL,
  });
}

export async function getSpeedScores(
  kv: KVNamespace | undefined,
  id: string,
): Promise<SpeedLogEntry | null> {
  if (!kv || !id) return null;
  const raw = await kv.get(`${SPEEDLOG_PREFIX}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SpeedLogEntry;
  } catch {
    return null;
  }
}

// --- share-link engagement -----------------------------------------
// Per-share-id record tracking whether the share link was copied
// (button click on the results screen) and how many times it was
// visited (GET /api/r/:id). Surfaced in the admin "Websites scanned"
// view so operators can see which scans turned into shareable reports
// and whether anyone clicked them. 90-day TTL matches the scan log;
// the underlying 7-day share report can already be gone while the
// engagement record is still valid for the admin view.
// Fail-soft: a write error here must never break copy or view.
const SHARESTAT_TTL = 90 * 24 * 60 * 60;
const SHARESTAT_PREFIX = "sharestat:";

export interface ShareStat {
  copied: boolean;
  visits: number;
}

export async function getShareStat(
  kv: KVNamespace | undefined,
  id: string,
): Promise<ShareStat | null> {
  if (!kv || !id) return null;
  const raw = await kv.get(`${SHARESTAT_PREFIX}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShareStat;
  } catch {
    return null;
  }
}

// Idempotent: once copied is true we skip the write.
export async function markShareCopied(
  kv: KVNamespace | undefined,
  id: string,
): Promise<void> {
  if (!kv || !id) return;
  const cur = (await getShareStat(kv, id)) || { copied: false, visits: 0 };
  if (cur.copied) return;
  cur.copied = true;
  await kv.put(`${SHARESTAT_PREFIX}${id}`, JSON.stringify(cur), {
    expirationTtl: SHARESTAT_TTL,
  });
}

// Read-modify-write increment. Same concurrent-loss caveat as the
// lifetime counters: under simultaneous visits an increment can be
// lost. Acceptable for a display-only engagement metric.
export async function bumpShareVisit(
  kv: KVNamespace | undefined,
  id: string,
): Promise<void> {
  if (!kv || !id) return;
  const cur = (await getShareStat(kv, id)) || { copied: false, visits: 0 };
  cur.visits = (cur.visits || 0) + 1;
  await kv.put(`${SHARESTAT_PREFIX}${id}`, JSON.stringify(cur), {
    expirationTtl: SHARESTAT_TTL,
  });
}

// --- lifetime totals -----------------------------------------------
// Two counters that NEVER expire, for the "used to scan N websites
// and M pages" social-proof line on the homepage. Independent of the
// 90-day scan log (which is recent-history for the operator).
//
// KV has no atomic increment, so this is read-modify-write. Under
// concurrent scans, an increment can be lost (two simultaneous bumps
// both read N, both write N+1, net +1 instead of +2). That under-
// counts, never over-counts, and at single-digit scans per day it
// rounds to zero. Acceptable for display.
const COUNTER_SCANS = "counter:scans-total";
const COUNTER_PAGES = "counter:pages-total";

export interface TotalCounters {
  scans: number;
  pages: number;
}

export async function readTotalCounters(
  kv: KVNamespace | undefined,
): Promise<TotalCounters> {
  if (!kv) return { scans: 0, pages: 0 };
  const [s, p] = await Promise.all([
    kv.get(COUNTER_SCANS),
    kv.get(COUNTER_PAGES),
  ]);
  return {
    scans: parseInt(s || "0", 10) || 0,
    pages: parseInt(p || "0", 10) || 0,
  };
}

// Fail-soft: a counter write must never break a completed scan, so
// the caller wraps this in try/catch.
export async function bumpTotalCounters(
  kv: KVNamespace | undefined,
  pagesDelta: number,
): Promise<void> {
  if (!kv) return;
  const cur = await readTotalCounters(kv);
  await Promise.all([
    kv.put(COUNTER_SCANS, String(cur.scans + 1)),
    kv.put(COUNTER_PAGES, String(cur.pages + Math.max(0, pagesDelta || 0))),
  ]);
}

// One-shot seed from the existing 90-day scan log. Idempotent: only
// writes when both counters are still 0 AND there are log entries to
// import. Called lazily by /api/stats on first hit after deploy so we
// do not need a manual admin step.
export async function seedTotalCountersFromLog(
  kv: KVNamespace | undefined,
): Promise<TotalCounters> {
  if (!kv) return { scans: 0, pages: 0 };
  const cur = await readTotalCounters(kv);
  if (cur.scans > 0 || cur.pages > 0) return cur;
  const log = await listScanLog(kv, 1000);
  if (log.length === 0) return cur;
  const scans = log.length;
  const pages = log.reduce((s, e) => s + (e.pages || 0), 0);
  await Promise.all([
    kv.put(COUNTER_SCANS, String(scans)),
    kv.put(COUNTER_PAGES, String(pages)),
  ]);
  return { scans, pages };
}

// --- contact messages ----------------------------------------------
const MSG_TTL = 180 * 24 * 60 * 60;
const MSG_PREFIX = "msg:";

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
  at: string;
}

export async function saveContactMessage(
  kv: KVNamespace | undefined,
  msg: ContactMessage,
): Promise<boolean> {
  if (!kv) return false;
  const rev = (1e15 - Date.now()).toString().padStart(16, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  await kv.put(`${MSG_PREFIX}${rev}:${rand}`, JSON.stringify(msg), {
    expirationTtl: MSG_TTL,
  });
  return true;
}

export async function listContactMessages(
  kv: KVNamespace | undefined,
  limit = 200,
): Promise<ContactMessage[]> {
  if (!kv) return [];
  const out: ContactMessage[] = [];
  const res: any = await kv.list({ prefix: MSG_PREFIX, limit });
  for (const k of res.keys) {
    const raw = await kv.get(k.name);
    if (raw) {
      try {
        out.push(JSON.parse(raw) as ContactMessage);
      } catch {}
    }
  }
  return out;
}

// Returns the persisted report as-is. The caller is responsible for
// branching on `result.schemaVersion` if it ever needs to handle older
// shapes (today there is only v1 in the wild, so no branching is
// needed). Treat an absent schemaVersion as v1 (legacy reports written
// before the field existed; harmless since v1 is the only version).
export async function getScan(
  kv: KVNamespace | undefined,
  id: string,
): Promise<ScanResult | null> {
  if (!kv) return null;
  const raw = await kv.get(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScanResult;
  } catch {
    return null;
  }
}
