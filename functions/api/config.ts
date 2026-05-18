// Public, non-secret runtime config for the frontend. Lets the
// Turnstile widget (A4) activate purely by setting Pages env vars,
// with no code change and no redeploy:
//   - TURNSTILE_SITEKEY set   => frontend renders the widget and sends
//                                a token; server (scan.ts) enforces it.
//   - TURNSTILE_SITEKEY unset => endpoint returns null; frontend skips
//                                the widget entirely (tool unchanged).
// The sitekey is PUBLIC by design (it ships in the page). The secret
// (TURNSTILE_SECRET) is never exposed here; it stays server-only.

interface Env {
  TURNSTILE_SITEKEY?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return new Response(
    JSON.stringify({ turnstileSiteKey: env.TURNSTILE_SITEKEY || null }),
    {
      headers: {
        "Content-Type": "application/json",
        // Short cache: a config flip should propagate within a minute,
        // not be pinned by a long-lived edge cache.
        "Cache-Control": "public, max-age=60",
      },
    },
  );
};
