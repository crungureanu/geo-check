import { saveContactMessage } from "../_lib/kv";
import { d1InsertMessage } from "../_lib/d1";

interface Env {
  SHARES?: KVNamespace;
  // Optional outbound email. If both are set, messages are also emailed
  // via Resend (https://resend.com). Without them, messages are still
  // safely stored in KV and visible on the admin page.
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
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

async function sendEmail(env: Env, m: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) return;
  const body = {
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    reply_to: m.email,
    subject: `XEOscan contact from ${m.name}`,
    text: `Name: ${m.name}\nEmail: ${m.email}\n\n${m.message}`,
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
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
  // autocomplete="off", which silently dropped real autofilled messages.
  if (clamp(raw?.website, 1)) return json({ ok: true });

  const name = clamp(raw?.name, 120);
  const email = clamp(raw?.email, 200);
  const message = clamp(raw?.message, 4000);

  if (!name || !email || !message) {
    return json({ ok: false, message: "Please fill in every field." }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, message: "Please enter a valid email." }, 400);
  }

  const record = { name, email, message, at: new Date().toISOString() };

  // Storing the message is the source of truth and must not be lost,
  // so it is awaited and its failure is reported. Email is best-effort.
  let stored = false;
  try {
    stored = await saveContactMessage(env.SHARES, record);
  } catch {
    stored = false;
  }
  if (!stored) {
    return json(
      { ok: false, message: "Could not send right now. Please try again later." },
      503,
    );
  }

  // D1 dual-write (scaffold): mirror the message row. Additive + fail-soft;
  // no-op unless D1 is enabled. KV above remains the source of truth.
  try {
    await d1InsertMessage(env, { name, email, message, at: Date.parse(record.at) || Date.now() });
  } catch {}

  try {
    await sendEmail(env, record);
  } catch {
    // Email is optional; the message is already stored and visible on
    // the admin page, so still report success to the user.
  }

  return json({ ok: true });
};
