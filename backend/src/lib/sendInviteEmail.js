const nodemailer = require("nodemailer");

/** Encode for HTML attribute values (href). Raw `&` breaks many mail clients' parsers. */
function escapeHtmlAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;");
}

/** Encode visible URL / text in body. */
function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildInviteHtml({ appName, passwordResetLink, invitedEmail }) {
  const safeEmail = String(invitedEmail || "").replace(/</g, "");
  const safeApp = String(appName || "CollectEase").replace(/</g, "");
  const hrefReset = escapeHtmlAttr(passwordResetLink);
  const visibleResetUrl = escapeHtmlText(passwordResetLink);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to ${safeApp} — set your password</title>
</head>
<body style="margin:0;background:#f4f8f8;font-family:'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#0f2744;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f8;padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid rgba(23,111,90,0.14);box-shadow:0 18px 38px rgba(15,39,68,0.08);">
          <tr>
            <td style="padding:0;">
              <div style="background:linear-gradient(170deg,#ecfdf5 0%,#f4fff8 45%,#ffffff 100%);padding:30px 32px 24px;text-align:center;border-bottom:1px solid rgba(23,111,90,0.1);">
                <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(23,111,90,0.12);color:#125546;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">${safeApp}</div>
                <h1 style="margin:14px 0 6px;color:#0f2744;font-size:24px;font-weight:800;letter-spacing:-0.025em;line-height:1.2;">Welcome aboard</h1>
                <p style="margin:0;color:rgba(15,39,68,0.62);font-size:14px;line-height:1.55;">You've been invited to ${safeApp}. Let's set up your account.</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 32px 8px;">
              <p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0f2744;">Set your password for the first time</p>
              <p style="margin:0;color:rgba(15,39,68,0.7);font-size:14px;line-height:1.6;">
                Use the button or the underlined link below to choose the password you'll use to sign in. After that, return to the app and sign in with
                <strong style="color:#125546;">${safeEmail}</strong> and your new password.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 26px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#176f5a" style="border-radius:12px;background-color:#176f5a;">
                    <a href="${hrefReset}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 30px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;line-height:1.25;">Set my password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-size:15px;line-height:1.5;">
                <a href="${hrefReset}" target="_blank" rel="noopener noreferrer" style="color:#125546;font-weight:700;text-decoration:underline;">Set my password</a>
              </p>
              <p style="margin:18px 0 0;font-size:12px;color:rgba(15,39,68,0.5);line-height:1.5;">This link can be used only once and expires after a short time.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 26px;">
              <div style="padding:14px 16px;border-radius:12px;background:#f8fafc;border:1px solid rgba(15,23,42,0.06);">
                <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(15,39,68,0.55);">Button not working?</p>
                <p style="margin:0;font-size:12px;color:rgba(15,39,68,0.7);line-height:1.55;word-break:break-all;">
                  Copy this URL into your browser, or tap the link:<br/>
                  <a href="${hrefReset}" target="_blank" rel="noopener noreferrer" style="color:#125546;font-weight:600;text-decoration:underline;">${visibleResetUrl}</a>
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 26px;text-align:center;">
              <p style="margin:0;font-size:12px;color:rgba(15,39,68,0.45);line-height:1.5;">
                This email was sent to <strong style="color:rgba(15,39,68,0.65);">${safeEmail}</strong>.
                If you didn't expect it, you can safely ignore this message.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:rgba(15,39,68,0.4);">© ${safeApp}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends HTML invite.
 * - If SMTP_HOST or SMTP_FROM is missing: { ok: false, skipped: true, reason } (no throw).
 * - If send fails: { ok: false, skipped: false, reason } (no throw — user is already created in Firebase).
 */
async function sendInviteEmail({ to, passwordResetLink }) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  const appName = process.env.INVITE_APP_NAME || "CollectEase";
  const html = buildInviteHtml({ appName, passwordResetLink, invitedEmail: to });

  if (!host || !from) {
    const reason = !host && !from ? "Set SMTP_HOST and SMTP_FROM in backend .env" : !host ? "Set SMTP_HOST" : "Set SMTP_FROM (or SMTP_USER)";
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[invite-email] skipped: ${reason}`);
    }
    return { ok: false, skipped: true, reason };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined
  });

  try {
    await transporter.sendMail({
      from,
      to,
      subject: `Welcome to ${appName} — set your password`,
      html,
      text: `You've been invited to ${appName}. Set your password for the first time here: ${passwordResetLink}`
    });
  } catch (e) {
    const reason = e?.message || String(e);
    // eslint-disable-next-line no-console
    console.error("[invite-email] sendMail failed:", reason);
    return { ok: false, skipped: false, reason };
  }

  return { ok: true };
}

module.exports = { sendInviteEmail, buildInviteHtml };
