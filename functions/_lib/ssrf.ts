// SSRF guard: refuse to fetch hosts that can only make sense from
// inside a network (loopback, RFC1918, link-local, CGNAT, reserved
// ranges, *.local-style names). A public website scanner has no
// legitimate reason to touch any of these, so blocking is pure
// upside: it cannot affect a real user scanning a real site.
//
// Two call sites:
//  - /api/scan input validation (friendly 400 before any work)
//  - fetcher.ts, on EVERY hop (initial, each HTTP redirect, the
//    meta-refresh target), because a public host can redirect to an
//    internal one.
//
// Note on obfuscated IPs (http://2130706433/, http://0x7f.1/ ...):
// the WHATWG URL parser used by Workers normalises all numeric IPv4
// forms to canonical dotted-quad in `hostname`, so checking the
// parsed hostname covers them.

// Hostname suffixes that resolve only on private networks (RFC 6762,
// RFC 8375) or via local resolver tricks.
const BLOCKED_NAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".localdomain",
];

function parseIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = [+m[1], +m[2], +m[3], +m[4]];
  return octets.every((o) => o <= 255) ? octets : null;
}

function blockedIpv4Reason(o: number[]): string | null {
  const [a, b] = o;
  if (a === 0) return "this-network";          // 0.0.0.0/8
  if (a === 10) return "private";              // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return "cgnat"; // 100.64.0.0/10
  if (a === 127) return "loopback";            // 127.0.0.0/8
  if (a === 169 && b === 254) return "link-local"; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return "private"; // 172.16.0.0/12
  if (a === 192 && b === 0 && (o[2] === 0 || o[2] === 2)) return "reserved"; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 192 && b === 168) return "private"; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return "benchmark"; // 198.18.0.0/15
  if (a === 198 && b === 51 && o[2] === 100) return "reserved"; // 198.51.100.0/24
  if (a === 203 && b === 0 && o[2] === 113) return "reserved"; // 203.0.113.0/24
  if (a >= 224) return "multicast-or-reserved"; // 224.0.0.0/4 + 240.0.0.0/4 + broadcast
  return null;
}

function blockedIpv6Reason(host: string): string | null {
  // URL.hostname keeps IPv6 bracketed and canonically compressed
  // (lowercase hex, "::" compression), so string checks are reliable.
  const ip = host.replace(/^\[/, "").replace(/\]$/, "");
  if (!ip.includes(":")) return null; // not IPv6
  // ::/16 covers unspecified (::), loopback (::1) and the
  // v4-mapped/compatible space (::ffff:a.b.c.d). Nothing publicly
  // scannable lives there.
  if (ip.startsWith("::") || ip === ":") return "loopback-or-mapped";
  if (ip.startsWith("64:ff9b:")) return "nat64"; // 64:ff9b::/96 maps to IPv4
  if (/^f[cd]/.test(ip)) return "private"; // fc00::/7 (ULA)
  if (/^fe[89ab]/.test(ip)) return "link-local"; // fe80::/10
  return null;
}

// Returns null when the host is fine to fetch, or a short machine
// reason string when it must be refused.
export function blockedHostReason(hostname: string): string | null {
  let host = hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // trailing-dot FQDN form
  if (!host) return "empty-host";

  if (host.startsWith("[") || host.includes(":")) {
    return blockedIpv6Reason(host);
  }

  const v4 = parseIpv4(host);
  if (v4) return blockedIpv4Reason(v4);

  if (host === "localhost") return "loopback";
  for (const suf of BLOCKED_NAME_SUFFIXES) {
    if (host.endsWith(suf)) return "private-name";
  }
  // Single-label names ("intranet", "router") only resolve via local
  // search domains; every public site has at least one dot.
  if (!host.includes(".")) return "single-label";

  return null;
}

// Convenience for call sites that hold a URL string. Unparseable
// input is NOT blocked here; the caller's own URL handling owns that
// error path.
export function blockedUrlReason(url: string): string | null {
  try {
    return blockedHostReason(new URL(url).hostname);
  } catch {
    return null;
  }
}
