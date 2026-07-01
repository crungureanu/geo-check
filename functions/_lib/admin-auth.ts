// Shared admin auth for the /admin/* endpoints (scans dashboard + exports).
// Extracted so every admin route enforces the exact same rule: a valid
// ADMIN_KEY may arrive once as ?key= (bookmark / first visit) but must not
// LIVE in the URL, where it leaks via history and CDN logs. A valid ?key= is
// swapped into an HttpOnly cookie with a redirect to the clean URL; every
// later request authenticates from the cookie. Wrong/absent key -> 404 (the
// endpoints stay invisible to probing).

export const ADMIN_COOKIE = "xeo_admin";

// Constant-time-ish compare so the secret cannot be guessed by timing.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function cookieValue(request: Request, name: string): string {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        return "";
      }
    }
  }
  return "";
}

export type AdminAuth = { ok: false } | { ok: true; setCookie: boolean };

export function checkAdminAuth(request: Request, adminKey: string | undefined): AdminAuth {
  if (!adminKey) return { ok: false };
  const cookie = cookieValue(request, ADMIN_COOKIE);
  if (cookie && safeEqual(cookie, adminKey)) return { ok: true, setCookie: false };
  const key = new URL(request.url).searchParams.get("key") || "";
  if (key && safeEqual(key, adminKey)) return { ok: true, setCookie: true };
  return { ok: false };
}

export function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });
}

// 302 to the same path without ?key=, carrying the auth cookie.
// Scoped to /admin, 30-day lifetime (re-visit with ?key= renews it).
export function redirectWithCookie(request: Request, adminKey: string): Response {
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.pathname,
      "Set-Cookie":
        `${ADMIN_COOKIE}=${encodeURIComponent(adminKey)}; Path=/admin; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "no-store",
    },
  });
}
