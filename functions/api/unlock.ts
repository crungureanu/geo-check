import { saveUnlockRequest, getOrCreateConnection } from "../_lib/kv";
import { d1InsertUnlockLeadAndConnection } from "../_lib/d1";
import { renderUnlockEmail } from "../_lib/unlock-email";

// POST /api/unlock — the "Unlock FREE" email capture on the Content
// area of the scan ladder. Validates + stores the lead, then issues the
// per-person connection token and emails the unlock link via Resend
// (first-time vs returning template chosen by whether the email already
// had a token). Same honeypot + validation contract as the contact form.

interface Env {
  SHARES?: KVNamespace;
  RESEND_API_KEY?: string;
  CONTACT_FROM?: string;
  DB?: D1Database;
  D1_ENABLED?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const clamp = (s: unknown, n: number): string =>
  typeof s === "string" ? s.trim().slice(0, n) : "";

async function sendUnlockEmail(
  env: Env,
  o: { to: string; kind: "first" | "returning"; site: string; unlockUrl: string; base: string },
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.CONTACT_FROM) return false;
  const mail = renderUnlockEmail(o);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: [o.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // Invisible deliverability header: mailbox providers (Yahoo/Gmail)
        // treat senders that offer a standard removal path more kindly.
        // Header only - the visible copy still never says "subscribe".
        headers: {
          "List-Unsubscribe": "<mailto:chris@chrisungureanu.com?subject=remove%20me>",
        },
      }),
      signal: ctrl.signal,
    });
    return res.ok;
  } finally {
    clearTimeout(t);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let raw: any;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, message: "Invalid request." }, 400);
  }

  // Honeypot: bots fill the hidden "website" field. Pretend success so
  // they do not retry, but store nothing. The field MUST keep a URL-style
  // name: Chrome autofills company/address-style names even with
  // autocomplete="off", which silently dropped real autofilled leads.
  if (clamp(raw?.website, 1)) return json({ ok: true });

  const email = clamp(raw?.email, 200);
  const url = clamp(raw?.url, 500);
  const id = clamp(raw?.id, 40) || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, message: "Please enter a valid email." }, 400);
  }

  // The lead record is the source of truth and must not be lost; it is
  // awaited and its failure reported. The email itself is sent after.
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

  // Issue (or reuse) the connection token and send the unlock link. The
  // link reopens this report with ?ct=<token>; the frontend stores the
  // token so every later scan unlocks without asking again.
  try {
    const conn = await getOrCreateConnection(env.SHARES, email);
    if (conn) {
      // D1 dual-write (scaffold): lead + per-person connection in one atomic
      // batch. Additive + fail-soft; no-op unless D1 is enabled.
      try {
        await d1InsertUnlockLeadAndConnection(env, { email, url, shareId: id, token: conn.token });
      } catch {}
      const base = new URL(request.url).origin;
      const unlockUrl = id
        ? `${base}/r/${id}?ct=${conn.token}`
        : `${base}/?ct=${conn.token}`;
      const sent = await sendUnlockEmail(env, {
        to: email,
        kind: conn.isNew ? "first" : "returning",
        site: url || base,
        unlockUrl,
        base,
      });
      if (!sent) {
        // Lead stored but email not configured/accepted: tell the user
        // honestly instead of pointing them at an inbox that stays empty.
        return json({
          ok: true,
          sent: false,
          message: "Saved. The unlock email could not be sent right now; I will follow up by email.",
        });
      }
    }
  } catch {
    return json({ ok: true, sent: false });
  }

  return json({ ok: true, sent: true });
};
