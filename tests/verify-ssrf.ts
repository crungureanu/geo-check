// SSRF guard: pure-logic test of the host blocklist (loopback,
// RFC1918, link-local, CGNAT, reserved, *.local-style names, numeric
// IP obfuscation via WHATWG URL normalisation) plus the public hosts
// that must NEVER be blocked. The live path cannot be exercised
// without deploying, so this guards the logic.
// Usage: node --import ./tests/register.mjs tests/verify-ssrf.ts
import { blockedHostReason, blockedUrlReason } from "../functions/_lib/ssrf.ts";

const probs: string[] = [];
const blocked = (host: string) => {
  if (blockedHostReason(host) === null) probs.push(`should BLOCK: ${host}`);
};
const allowed = (host: string) => {
  const r = blockedHostReason(host);
  if (r !== null) probs.push(`should ALLOW: ${host} (got ${r})`);
};

// Loopback / unspecified / names.
for (const h of ["localhost", "LOCALHOST", "localhost.", "127.0.0.1", "127.8.9.10", "0.0.0.0", "0.1.2.3"]) blocked(h);

// RFC1918 + CGNAT + link-local (incl. cloud metadata 169.254.169.254).
for (const h of [
  "10.0.0.1", "10.255.255.255",
  "172.16.0.1", "172.31.255.255",
  "192.168.0.1", "192.168.255.255",
  "100.64.0.1", "100.127.255.255",
  "169.254.169.254", "169.254.0.1",
]) blocked(h);

// Reserved / benchmark / multicast / broadcast.
for (const h of [
  "192.0.0.1", "192.0.2.55",
  "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9",
  "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
]) blocked(h);

// IPv6 internal space.
for (const h of ["[::1]", "[::]", "fd00::1", "fc00::1", "fe80::1", "[fe80::1%25eth0]", "[64:ff9b::7f00:1]"]) blocked(h);

// Private-only name suffixes + single-label intranet names.
for (const h of ["foo.local", "printer.internal", "nas.home.arpa", "app.localhost", "box.localdomain", "intranet", "router"]) blocked(h);

// Numeric-IP obfuscation: the URL parser must normalise these to
// dotted-quad before our check sees them.
for (const u of ["http://2130706433/", "http://0x7f000001/", "http://017700000001/", "http://0x7f.0.0.1/"]) {
  if (blockedUrlReason(u) === null) probs.push(`should BLOCK via URL norm: ${u}`);
}

// Public hosts and near-boundary public IPs must pass.
for (const h of [
  "example.com", "xeoscan.ai", "www.gov.uk", "sub.domain.co.uk",
  "8.8.8.8", "1.1.1.1", "11.0.0.1", "9.255.255.255",
  "172.15.255.255", "172.32.0.1",
  "100.63.255.255", "100.128.0.1",
  "192.167.0.1", "192.169.0.1", "192.0.1.1", "192.0.3.1",
  "198.17.0.1", "198.20.0.1", "198.51.101.1", "203.0.114.1",
  "223.255.255.255",
  "[2606:4700::6810:84e5]", "2606:4700:4700::1111",
]) allowed(h);

// Unparseable input is the caller's error path, not a block.
if (blockedUrlReason("not a url") !== null) probs.push("unparseable URL must not be blocked here");

if (probs.length === 0) {
  console.log("PASS ssrf (loopback/private/link-local/CGNAT/reserved blocked; numeric obfuscation normalised; public hosts allowed)");
  process.exit(0);
} else {
  console.log("FAIL ssrf");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
