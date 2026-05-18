// A4: Cloudflare Turnstile verification (human/bot gate on every scan).
//
// CONFIG-GATED and INERT until set up:
//   - No TURNSTILE_SECRET env  => verification SKIPPED (fail open). The
//     tool behaves exactly as before. Deploying this code changes
//     nothing until the widget exists in the dashboard.
//   - TURNSTILE_SECRET present => a scan without a valid token is
//     rejected.
//
// Fail-CLOSED on a real negative verdict (token missing or token
// present-but-invalid: that is a bot or a replayed/expired token, so
// block). Fail-OPEN only when Cloudflare's siteverify endpoint itself
// is unreachable: do NOT 4xx every real user because the verify API
// blipped (same philosophy as the A3 cap; and if Cloudflare is down
// the Pages site is likely down anyway).

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean; // true => allowed to proceed
  skipped: boolean; // true => not configured / verify unreachable (inert)
  reason?: string;
}

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  remoteIp?: string,
  // injectable for offline testing; defaults to global fetch in prod
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!secret) return { ok: true, skipped: true, reason: "not-configured" };
  if (!token || typeof token !== "string") {
    return { ok: false, skipped: false, reason: "missing-token" };
  }

  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (remoteIp) form.append("remoteip", remoteIp);

    const res = await fetchImpl(SITEVERIFY_URL, { method: "POST", body: form });
    const data = (await res.json()) as {
      success?: boolean;
      ["error-codes"]?: string[];
    };

    if (data && data.success === true) return { ok: true, skipped: false };
    return {
      ok: false,
      skipped: false,
      reason:
        (data && data["error-codes"] && data["error-codes"].join(",")) ||
        "verify-failed",
    };
  } catch {
    // siteverify unreachable: fail open so a verify-API outage does not
    // take the whole tool down. Marked skipped so the caller can log it.
    return { ok: true, skipped: true, reason: "verify-unreachable" };
  }
}
