import { getScan, bumpShareVisit } from "../../_lib/kv";

interface Env {
  SHARES?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestGet: PagesFunction<Env, "id"> = async ({ params, env }) => {
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
  return json({ ok: true, result });
};
