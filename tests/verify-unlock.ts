// Unlock / connection-token logic: pure-logic test with a mock KV.
// Asserts: token issue + reuse per email, token validation (format +
// existence), redemption timestamping (first only), unlock-lead listing
// with redeemed annotation, GDPR delete cascade (lead + token + reverse
// index), and the renderUnlockEmail templates (copy rules: no em dash,
// no "subscribe", correct variant text and link).
// Usage: node --import ./tests/register.mjs tests/verify-unlock.ts
import {
  getOrCreateConnection,
  getConnection,
  markConnectionRedeemed,
  saveUnlockRequest,
  listUnlockRequests,
  deleteUnlockLead,
} from "../functions/_lib/kv.ts";
import { renderUnlockEmail } from "../functions/_lib/unlock-email.ts";

const probs: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) probs.push(msg);
};

function mockKV() {
  const m = new Map<string, string>();
  return {
    store: m,
    async get(k: string) {
      return m.has(k) ? (m.get(k) as string) : null;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
    async delete(k: string) {
      m.delete(k);
    },
    async list(o: { prefix: string; limit?: number }) {
      const keys = [...m.keys()]
        .filter((k) => k.startsWith(o.prefix))
        .sort()
        .slice(0, o.limit ?? 1000)
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  } as any;
}

// crypto.getRandomValues exists in Node 24 globals; sanity-guard anyway.
ok(typeof crypto?.getRandomValues === "function", "crypto.getRandomValues missing in this runtime");

// 1. No KV => null (caller treats as "could not issue").
{
  const r = await getOrCreateConnection(undefined, "a@b.com");
  ok(r === null, "no-KV getOrCreateConnection must return null");
}

// 2. Issue + reuse: same email gets the SAME token, flagged not-new.
{
  const kv = mockKV();
  const first = await getOrCreateConnection(kv, "Person@Example.com");
  ok(!!first && first.isNew === true, "first issue must be isNew");
  const again = await getOrCreateConnection(kv, "person@example.com");
  ok(!!again && again.isNew === false, "same email (case-insensitive) must reuse");
  ok(first!.token === again!.token, "reused token must match");
  ok(/^[a-z0-9]{10,40}$/.test(first!.token), `token format unexpected: ${first!.token}`);
}

// 3. Validation: bad format, unknown token, real token.
{
  const kv = mockKV();
  const { token } = (await getOrCreateConnection(kv, "x@y.com"))!;
  ok((await getConnection(kv, token))?.email === "x@y.com", "valid token must resolve");
  ok((await getConnection(kv, "NOT-A-TOKEN!")) === null, "bad-format token must be rejected");
  ok((await getConnection(kv, "a".repeat(26))) === null, "unknown token must be rejected");
  ok((await getConnection(kv, null)) === null, "null token must be rejected");
}

// 4. Redemption: stamped once, never overwritten.
{
  const kv = mockKV();
  const { token } = (await getOrCreateConnection(kv, "x@y.com"))!;
  await markConnectionRedeemed(kv, token);
  const t1 = (await getConnection(kv, token))!.redeemedAt;
  ok(!!t1, "redeemedAt must be set");
  await new Promise((r) => setTimeout(r, 5));
  await markConnectionRedeemed(kv, token);
  const t2 = (await getConnection(kv, token))!.redeemedAt;
  ok(t1 === t2, "redeemedAt must not change on second redemption");
}

// 5. Lead listing annotates redemption; GDPR delete cascades.
{
  const kv = mockKV();
  await saveUnlockRequest(kv, { email: "lead@site.com", url: "https://site.com", id: "abc", at: new Date().toISOString() });
  const { token } = (await getOrCreateConnection(kv, "lead@site.com"))!;
  let leads = await listUnlockRequests(kv);
  ok(leads.length === 1, `expected 1 lead, got ${leads.length}`);
  ok(leads[0].redeemed === false, "unredeemed lead must show redeemed=false");
  await markConnectionRedeemed(kv, token);
  leads = await listUnlockRequests(kv);
  ok(leads[0].redeemed === true, "redeemed lead must show redeemed=true");

  ok((await deleteUnlockLead(kv, "scanlog:nope")) === false, "delete must be prefix-guarded");
  ok((await deleteUnlockLead(kv, leads[0].key!)) === true, "delete must accept the lead key");
  ok((await listUnlockRequests(kv)).length === 0, "lead row must be gone");
  ok((await getConnection(kv, token)) === null, "connection token must be cascaded away");
  const again = await getOrCreateConnection(kv, "lead@site.com");
  ok(again!.isNew === true, "after GDPR delete the email must be brand new again");
}

// 6. Email templates: variant copy, link, and the copy rules.
{
  for (const kind of ["first", "returning"] as const) {
    const mail = renderUnlockEmail({
      kind,
      site: "https://example.com/",
      unlockUrl: "https://xeoscan.ai/r/abc?ct=tok123",
      base: "https://xeoscan.ai",
    });
    const all = mail.subject + mail.html + mail.text;
    ok(!/[—–]/.test(all), `${kind}: public email copy must not contain em/en dashes`);
    ok(!/subscribe/i.test(all), `${kind}: email copy must never say subscribe`);
    ok(all.includes("https://xeoscan.ai/r/abc?ct=tok123"), `${kind}: unlock URL missing`);
    ok(mail.html.includes("/img/email-logo.png") && mail.html.includes("/img/email-avatar.png"), `${kind}: image assets missing`);
    ok(mail.html.includes("example.com") && !mail.html.includes("https://example.com/</strong>"), `${kind}: site should render bare (no scheme/trailing slash)`);
  }
  const first = renderUnlockEmail({ kind: "first", site: "x.com", unlockUrl: "u", base: "b" });
  const ret = renderUnlockEmail({ kind: "returning", site: "x.com", unlockUrl: "u", base: "b" });
  ok(first.html.includes("Good to connect!"), "first variant heading missing");
  ok(ret.html.includes("Welcome back!"), "returning variant heading missing");
  ok(first.subject !== ret.subject, "variants must have distinct subjects");
}

if (probs.length === 0) {
  console.log(
    "PASS unlock (token issue/reuse, validation, single redemption stamp, lead listing, GDPR cascade, email templates incl. copy rules)",
  );
  process.exit(0);
} else {
  console.log("FAIL unlock");
  for (const p of probs) console.log(`  ${p}`);
  process.exit(1);
}
