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
