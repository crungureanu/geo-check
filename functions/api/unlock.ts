import { saveUnlockRequest } from "../_lib/kv";

// POST /api/unlock — the "Unlock FREE" email capture on the Content
// area of the scan ladder. Phase 1: validate + store the lead in KV.
// Phase 2 adds: send the actual unlock link via Resend and redeem it
// into a content-scan run. Same honeypot + validation contract as the
// contact form.

interface Env {
  SHARES?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const clamp = (s: unknown, n: number): string =>
  typeof s === "string" ? s.trim().slice(0, n) : "";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let raw: any;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, message: "Invalid request." }, 400);
  }

  // Honeypot: bots fill the hidden "company" field. Pretend success so
  // they do not retry, but store nothing.
  if (clamp(raw?.company, 1)) return json({ ok: true });

  const email = clamp(raw?.email, 200);
  const url = clamp(raw?.url, 500);
  const id = clamp(raw?.id, 40) || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, message: "Please enter a valid email." }, 400);
  }

  let stored = false;
  try {
    stored = await saveUnlockRequest(env.SHARES, {
      email,
      url,
      id,
      at: new Date().toISOString(),
    });
  } catch {
    stored = false;
  }
  if (!stored) {
    return json(
      { ok: false, message: "Could not send right now. Please try again later." },
      503,
    );
  }

  return json({ ok: true });
};
