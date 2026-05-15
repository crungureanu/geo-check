import type { ScanResult } from "./types";

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
  const payload: ScanResult = { ...result, id, ttl: TTL_SECONDS };
  await kv.put(id, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  return id;
}

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
