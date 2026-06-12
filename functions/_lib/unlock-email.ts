// Unlock-link emails (templates approved 2026-06-12; the design source
// of truth is temp/email-templates/*.html). Two variants: first-time
// connection and returning connection. Email-safe table HTML + a plain
// text alternative. Public-facing copy: no em dashes, never "subscribe".

export interface UnlockEmail {
  subject: string;
  html: string;
  text: string;
}

const FONT = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(o: {
  base: string;
  preheader: string;
  heading: string;
  intro: string; // already-escaped HTML
  unlockUrl: string;
  buttonNote: string;
  replyLine: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.heading)}</title></head>
<body style="margin:0; padding:0; background-color:#f6f4ef;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(o.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f6f4ef;">
    <tr><td align="center" style="padding:36px 16px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; width:100%;">
        <tr><td style="padding:0 8px 18px;">
          <img src="${o.base}/img/email-logo.png" width="131" height="33" alt="XEOscan" style="display:block; border:0;">
        </td></tr>
        <tr><td style="background-color:#ffffff; border:1px solid #e7e5e1; border-radius:14px; padding:32px 32px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-family:${FONT}; font-size:17px; font-weight:700; color:#18181b; padding-bottom:14px;">${esc(o.heading)}</td></tr>
            <tr><td style="font-family:${FONT}; font-size:15px; line-height:1.65; color:#3f3f46; padding-bottom:8px;">${o.intro}</td></tr>
            <tr><td align="center" style="padding:20px 0 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center" bgcolor="#6d28d9" style="border-radius:11px;">
                  <a href="${o.unlockUrl}" style="display:inline-block; padding:14px 34px; font-family:${FONT}; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:11px;">Open your Content scan</a>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="font-family:${FONT}; font-size:13px; line-height:1.6; color:#71717a; padding:10px 0 18px; text-align:center;">${esc(o.buttonNote)}</td></tr>
            <tr><td style="border-top:1px solid #e7e5e1; padding-top:18px; font-family:${FONT}; font-size:14px; line-height:1.6; color:#3f3f46;">${esc(o.replyLine)}</td></tr>
            <tr><td style="padding-top:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="56" style="vertical-align:middle;">
                    <img src="${o.base}/img/email-avatar.png" width="56" height="56" alt="Constantin Ungureanu" style="display:block; border:0; border-radius:50%;">
                  </td>
                  <td style="vertical-align:middle; padding-left:14px; font-family:${FONT};">
                    <span style="display:block; font-size:14px; font-weight:600; color:#18181b;">Constantin Ungureanu</span>
                    <span style="display:block; font-size:12.5px; color:#71717a; padding-top:2px;">Creator of XEOscan</span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 8px 0; font-family:${FONT}; font-size:11.5px; line-height:1.6; color:#a1a1aa; text-align:center;">
          You received this one email because you requested an unlock link at xeoscan.ai.<br>
          No spam, and you can ask me to remove you any time, just reply.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderUnlockEmail(o: {
  kind: "first" | "returning";
  site: string;
  unlockUrl: string;
  base: string;
}): UnlockEmail {
  const site = o.site.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const first = o.kind === "first";
  const heading = first ? "Good to connect!" : "Welcome back!";
  const subject = first
    ? "Your Content scan unlock link"
    : "Welcome back, here is your unlock link";
  const intro = first
    ? `Here is your unlock link for the Content scan on <strong style="color:#18181b;">${esc(site)}</strong>. It opens your report with the deeper content checks already running.`
    : `You are already a connection, so here is your fresh unlock link for the Content scan on <strong style="color:#18181b;">${esc(site)}</strong>.`;
  const buttonNote = first
    ? "Open it once and this browser will remember you: every future scan unlocks automatically."
    : "Open it once on this device and your browser will remember you again.";
  const replyLine = first
    ? "And if you ever want to talk about what the scan finds, just reply. I read every email."
    : "How is the site doing since your last scan? If anything in the report needs a second pair of eyes, just reply.";

  const html = layout({
    base: o.base,
    preheader: first ? "Your Content scan unlock link is inside." : "Your fresh unlock link is inside.",
    heading,
    intro,
    unlockUrl: o.unlockUrl,
    buttonNote,
    replyLine,
  });

  const text = [
    heading,
    "",
    first
      ? `Here is your unlock link for the Content scan on ${site}. It opens your report with the deeper content checks already running.`
      : `You are already a connection, so here is your fresh unlock link for the Content scan on ${site}.`,
    "",
    `Open your Content scan: ${o.unlockUrl}`,
    "",
    buttonNote,
    "",
    replyLine,
    "",
    "Constantin Ungureanu",
    "Creator of XEOscan",
    "",
    "You received this one email because you requested an unlock link at xeoscan.ai.",
    "No spam, and you can ask me to remove you any time, just reply.",
  ].join("\n");

  return { subject, html, text };
}
