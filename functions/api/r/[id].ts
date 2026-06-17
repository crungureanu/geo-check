import { getScan, bumpShareVisit, getConnection, markConnectionRedeemed } from "../../_lib/kv";
import { d1BumpVisit, d1MarkConnectionRedeemed, d1StampScanEmail } from "../../_lib/d1";

interface Env {
  SHARES?: KVNamespace;
  DB?: D1Database;
  D1_ENABLED?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestGet: PagesFunction<Env, "id"> = async ({ params, request, env }) => {
  const id = params.id;
  if (!id || typeof id !== "string") return json({ error: "id required" }, 400);
  if (!/^[A-Za-z0-9]+$/.test(id)) return json({ error: "invalid id" }, 400);
  const result = await getScan(env.SHARES, id);
  if (!result) return json({ error: "not_found" }, 404);
  // Engagement counter. Fail-soft: a write error here must never
  // block the user from seeing their report.
  try {
    await bumpShareVisit(env.SHARES, id);
  } catch {}
  // D1 dual-write (scaffold): atomic visit increment. No-op unless enabled.
  try {
    await d1BumpVisit(env, id);
  } catch {}
  // Email-unlock gate: bar-3 content data stays in KV but leaves the API
  // only for a verified connection token (?ct=, from the unlock email or
  // the browser's stored copy). Strip otherwise.
  const ct = new URL(request.url).searchParams.get("ct");
  let unlocked = false;
  try {
    const conn = await getConnection(env.SHARES, ct);
    if (conn) {
      unlocked = true;
      if (!conn.redeemedAt) await markConnectionRedeemed(env.SHARES, ct!);
      // D1 dual-write (scaffold): mirror the redeemed-at stamp so the admin's
      // "content genuinely unlocked" join is accurate, and backfill this
      // scan row's email (it was null for a first-time unlocker) so that
      // join keyed on scans.email actually lights up. No-op unless enabled.
      try {
        await d1MarkConnectionRedeemed(env, ct!);
        if (conn.email) await d1StampScanEmail(env, id, conn.email);
      } catch {}
    }
  } catch {}
  if (unlocked) return json({ ok: true, unlocked: true, result });
  const { contentFindings: _cf, ...pub } = result as any;
  const pubScores = { ...(result as any).scores };
  delete pubScores.content;
  return json({ ok: true, result: { ...pub, scores: pubScores } });
};
