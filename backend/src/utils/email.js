function normEmail(e) {
  return String(e || "")
    .trim()
    .toLowerCase();
}

/** First / platform owner — full access (super_admin). Others use invitations only. */
const DEFAULT_SUPER_ADMIN_EMAILS = ["developer@collectease360.com"];

/**
 * Emails that bootstrap or retain super_admin (all companies + create companies).
 * Merges DEFAULT_SUPER_ADMIN_EMAILS with CT_SUPER_ADMIN_EMAILS (comma/space-separated).
 */
function parseSuperAdminEmails() {
  const raw = process.env.CT_SUPER_ADMIN_EMAILS || "";
  const fromEnv = raw
    .split(/[,;\s]+/)
    .map((s) => normEmail(s))
    .filter(Boolean);
  const set = new Set([...DEFAULT_SUPER_ADMIN_EMAILS.map(normEmail), ...fromEnv]);
  return [...set];
}

module.exports = { normEmail, parseSuperAdminEmails, DEFAULT_SUPER_ADMIN_EMAILS };
