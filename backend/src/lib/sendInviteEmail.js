const nodemailer = require("nodemailer");

function buildInviteHtml({ appName, passwordResetLink, invitedEmail }) {
  const safeEmail = String(invitedEmail || "").replace(/</g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your CollectEase invitation</title>
</head>
<body style="margin:0;background:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:linear-gradient(165deg,#1e293b 0%,#0f172a 100%);border-radius:20px;overflow:hidden;border:1px solid rgba(148,163,184,0.2);box-shadow:0 24px 48px rgba(0,0,0,0.35);">
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <div style="display:inline-block;padding:10px 18px;border-radius:999px;background:rgba(34,197,94,0.15);color:#4ade80;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Invitation</div>
              <h1 style="margin:18px 0 8px;color:#f8fafc;font-size:24px;font-weight:700;letter-spacing:-0.02em;">Welcome to ${appName}</h1>
              <p style="margin:0;color:#94a3b8;font-size:15px;line-height:1.55;">You’ve been invited to the collection dashboard. Click below to choose a password, then sign in on the app with your email and password.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;text-align:center;">
              <a href="${passwordResetLink}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(180deg,#22c55e,#16a34a);color:#052e16;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 8px 24px rgba(34,197,94,0.35);">Set your password</a>
              <p style="margin:20px 0 0;font-size:12px;color:#64748b;line-height:1.5;">This link was sent to <strong style="color:#cbd5e1;">${safeEmail}</strong>. If you didn’t expect it, you can ignore this message.</p>
              <p style="margin:16px 0 0;font-size:11px;color:#475569;word-break:break-all;">If the button doesn’t work, paste this URL into your browser:<br/><span style="color:#94a3b8;">${passwordResetLink}</span></p>
            </td>
          </tr>
        </table>
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
      subject: `You’re invited to ${appName}`,
      html,
      text: `Set your password for ${appName}: ${passwordResetLink}`
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
