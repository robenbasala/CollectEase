/** Escape text for safe insertion into HTML. */
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text preview for logs (strip tags). */
export function plainTextFromHtml(html, maxLen = 400) {
  const t = String(html ?? "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function formatBalanceUsd(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return escapeHtml(String(value ?? "—"));
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/**
 * Power Apps–style payment reminder HTML (static layout + row data).
 * @param {Record<string, unknown>} unit — dashboard unit row (name, balance, email, …)
 * @param {{ companyDisplayName?: string; senderName?: string; replyEmail?: string; senderPhone?: string }} ctx
 */
export function buildPaymentReminderEmailHtml(unit, ctx = {}) {
  const tenantName = escapeHtml(unit?.name ?? unit?.TenantName ?? "");
  const balanceHtml = formatBalanceUsd(unit?.balance);
  const senderName = escapeHtml(ctx.senderName || ctx.companyDisplayName?.trim().split(/\s+/)[0] || "Team");
  const companyName = escapeHtml(ctx.companyDisplayName || "");
  const replyEmail = escapeHtml(ctx.replyEmail || "");
  const senderPhone = escapeHtml(ctx.senderPhone || "");

  const contactEmailLine = replyEmail
    ? `<p>📧 Email: ${replyEmail}</p>`
    : `<p>📧 Email: <em style="color:#adb5bd;">Not configured</em></p>`;
  const contactPhoneLine = senderPhone
    ? `<p>📞 Phone: ${senderPhone}</p>`
    : `<p>📞 Phone: <em style="color:#adb5bd;">Not configured</em></p>`;

  const ctaMail = ctx.replyEmail
    ? `mailto:${String(ctx.replyEmail).trim()}?subject=${encodeURIComponent("Payment Arrangement Request")}`
    : `mailto:?subject=${encodeURIComponent("Payment Arrangement Request")}`;
  const ctaHrefAttr = escapeAttr(ctaMail);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder</title>
  <style>
    body { margin: 0; padding: 10px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.4; color: #333333; background-color: #f8f9fa; font-size: 12px; }
    .email-container { max-width: 552px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 12px 19px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.3px; }
    .content { padding: 14px 19px 17px; }
    .greeting { font-size: 12px; margin-bottom: 7px; color: #2c3e50; }
    .balance-highlight { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 10px 13px; margin: 10px 0; text-align: center; }
    .balance-amount { font-size: 20px; font-weight: 700; color: #d63384; margin: 0; line-height: 1.15; }
    .balance-label { font-size: 10px; color: #6c757d; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.7px; }
    .message-body { font-size: 11.5px; line-height: 1.45; margin: 7px 0; color: #495057; }
    .message-body p { margin: 5px 0; }
    .urgency-notice { background-color: #f8d7da; border-left: 3px solid #dc3545; padding: 6px 11px; margin: 10px 0; border-radius: 0 4px 4px 0; }
    .urgency-notice p { margin: 0; color: #721c24; font-weight: 500; font-size: 11px; line-height: 1.4; }
    .cta-section { text-align: center; margin: 11px 0 10px; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff !important; text-decoration: none; padding: 7px 17px; border-radius: 5px; font-weight: 600; font-size: 11.5px; }
    .contact-info { background-color: #f8f9fa; padding: 8px 12px 10px; border-radius: 6px; margin: 10px 0 0; border: 1px solid #e9ecef; }
    .contact-info h3 { margin: 0 0 4px 0; color: #495057; font-size: 11.5px; }
    .contact-info p { margin: 2px 0; color: #6c757d; font-size: 10.5px; line-height: 1.4; }
    .signature { margin-top: 10px; padding-top: 7px; border-top: 1px solid #e9ecef; }
    .signature-name { font-weight: 600; color: #2c3e50; font-size: 11.5px; }
    .signature p { font-size: 10.5px !important; margin: 2px 0 0 0 !important; }
    @media (max-width: 552px) {
      .email-container { margin: 0; box-shadow: none; }
      .header, .content { padding-left: 14px; padding-right: 14px; }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>Payment Reminder</h1>
    </div>
    <div class="content">
      <div class="greeting">Hi <strong>${tenantName}</strong>,</div>
      <div class="message-body">
        <p>We hope this message finds you well. We wanted to reach out regarding your account balance, which is currently past due.</p>
      </div>
      <div class="balance-highlight">
        <div class="balance-amount">${balanceHtml}</div>
        <div class="balance-label">Outstanding Balance</div>
      </div>
      <div class="urgency-notice">
        <p>If payment is not received or arrangements are not made, we may need to escalate this matter further.</p>
      </div>
      <div class="cta-section">
        <a href="${ctaHrefAttr}" class="cta-button">Contact Us Today</a>
      </div>
      <div class="message-body">
        <p>We appreciate your prompt attention to this matter. Thank you for your cooperation.</p>
      </div>
      <div class="signature">
        <div class="signature-name">${senderName}</div>
        <p>Accounts Receivable Department${companyName ? `<br>${companyName}` : ""}</p>
      </div>
      <div class="contact-info">
        <h3>Need to Discuss Payment Options?</h3>
        ${contactEmailLine}
        ${contactPhoneLine}
        <p>🕒 Business Hours: Monday - Friday, 9:00 AM - 5:00 PM</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
