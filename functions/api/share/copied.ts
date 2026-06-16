import { markShareCopied } from "../../_lib/kv";
import { d1MarkCopied } from "../../_lib/d1";

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

// Fired by the page when the user clicks either "Copy share link"
// button. Fire-and-forget from the client; we always return ok so a
// transient KV failure can never surface as a user-visible error on
// what is purely an engagement signal.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let raw: any;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: true });
  }
  const id = typeof raw?.id === "string" ? raw.id : "";
  // Same id shape as the share GET endpoint.
  if (!id || !/^[A-Za-z0-9]+$/.test(id) || id.length > 32) {
    return json({ ok: true });
  }
  try {
    await markShareCopied(env.SHARES, id);
  } catch {}
  // D1 dual-write (scaffold): mark copied on the scans row. No-op unless enabled.
  try {
    await d1MarkCopied(env, id);
  } catch {}
  return json({ ok: true });
};
