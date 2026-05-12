const { sql, query } = require("../db");
const { getFirebaseAuth } = require("../lib/firebaseAdmin");
const { sendInviteEmail, buildInviteHtml } = require("../lib/sendInviteEmail");
const { normEmail } = require("../utils/email");
const {
  userAlreadyProvisioned,
  setClaimsForUid,
  listUsersForCompany,
  getCompanyName,
  patchUserClaims,
  validatePropertyIdsForCompany
} = require("../services/authTenant");

function publicOrigin() {
  const o = process.env.APP_PUBLIC_ORIGIN || process.env.VITE_DEV_ORIGIN || "http://localhost:5173";
  return String(o).replace(/\/+$/, "");
}

/**
 * Firebase's `generatePasswordResetLink` returns a hosted URL like
 *   https://<project>.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=...&apiKey=...
 * Rewrite it so users land on our designed /reset-password page instead of the default Firebase UI.
 * `verifyPasswordResetCode` / `confirmPasswordReset` on the client validate the same oobCode regardless.
 */
function rewriteToAppResetPage(firebaseLink) {
  try {
    const u = new URL(firebaseLink);
    const oobCode = u.searchParams.get("oobCode");
    if (!oobCode) return firebaseLink;
    const target = new URL("/reset-password", publicOrigin());
    for (const key of ["mode", "oobCode", "apiKey", "lang", "continueUrl"]) {
      const v = u.searchParams.get(key);
      if (v != null) target.searchParams.set(key, v);
    }
    if (!target.searchParams.get("mode")) target.searchParams.set("mode", "resetPassword");
    return target.toString();
  } catch {
    return firebaseLink;
  }
}

async function recordPendingInvitation({ email, companyId, role, propertyIds }) {
  try {
    await query(
      `INSERT INTO dbo.UserInvitation (Email, CompanyId, Role, PropertyIdsJson, CreatedByAppUserId)
       VALUES (@email, @companyId, @role, @propertyIdsJson, NULL)`,
      {
        email: { type: sql.NVarChar(320), value: email },
        companyId: { type: sql.Int, value: companyId },
        role: { type: sql.NVarChar(32), value: role },
        propertyIdsJson: {
          type: sql.NVarChar(sql.MAX),
          value: JSON.stringify(Array.isArray(propertyIds) ? propertyIds : [])
        }
      }
    );
  } catch (e) {
    // Keep invite delivery working even on databases that have not run the auth migration yet.
    if (/Invalid object name/i.test(String(e?.message || ""))) return;
    throw e;
  }
}

async function getMe(req, res) {
  const u = req.ct;
  res.json({
    user: {
      id: u.userId,
      email: u.email,
      displayName: u.displayName,
      companyId: u.companyId,
      role: u.role,
      allowedPropertyNames: u.allowedPropertyNames
    }
  });
}

async function postInvite(req, res) {
  const actor = req.ct;
  if (actor.role !== "super_admin" && actor.role !== "company_admin") {
    return res.status(403).json({ error: "Only administrators can send invitations." });
  }
  const b = req.body || {};
  const email = normEmail(b.email);
  const role = String(b.role || "member").toLowerCase();
  const targetCompanyId = b.companyId != null ? Number(b.companyId) : actor.companyId;
  const propertyIds = Array.isArray(b.propertyIds) ? b.propertyIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : [];

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }
  if (role !== "member" && role !== "company_admin") {
    return res.status(400).json({ error: "role must be member or company_admin" });
  }
  if (!Number.isInteger(targetCompanyId) || targetCompanyId <= 0) {
    return res.status(400).json({ error: "companyId is required" });
  }

  if (actor.role === "company_admin") {
    if (targetCompanyId !== actor.companyId) {
      return res.status(403).json({ error: "Cannot invite to another company." });
    }
  } else if (actor.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (role === "member" && propertyIds.length === 0) {
    return res.status(400).json({ error: "Members need at least one property (propertyIds)." });
  }

  if (propertyIds.length > 0) {
    const valid = await validatePropertyIdsForCompany(targetCompanyId, propertyIds);
    if (valid == null) {
      return res.status(400).json({ error: "One or more propertyIds are invalid for this company." });
    }
  }

  if (await userAlreadyProvisioned(email)) {
    return res.status(409).json({ error: "This email already has access. Edit the user in Admin or revoke claims in Firebase Console." });
  }

  const auth = getFirebaseAuth();
  try {
    let rec;
    try {
      rec = await auth.getUserByEmail(email);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
      rec = await auth.createUser({
        email,
        emailVerified: false,
        disabled: false
      });
    }
    await setClaimsForUid(rec.uid, {
      role,
      companyId: targetCompanyId,
      propertyIds: role === "member" ? propertyIds : []
    });
    await recordPendingInvitation({
      email,
      companyId: targetCompanyId,
      role,
      propertyIds: role === "member" ? propertyIds : []
    });

    const continueUrl = `${publicOrigin()}/login`;
    const firebaseResetLink = await auth.generatePasswordResetLink(email, { url: continueUrl });
    const passwordResetLink = rewriteToAppResetPage(firebaseResetLink);

    const appNameInvite = process.env.INVITE_APP_NAME || "CollectEase";
    const inviteSubject = `Welcome to ${appNameInvite} — set your password`;
    const inviteHtml = buildInviteHtml({
      appName: appNameInvite,
      passwordResetLink,
      invitedEmail: email
    });

    /** When true, server skips SMTP so the admin client can send the same HTML via Microsoft Graph (unit-detail flow). */
    const preferMailbox = Boolean(b.preferMailboxDelivery);

    let mailResult = { ok: false, skipped: true };
    if (!preferMailbox) {
      mailResult = await sendInviteEmail({ to: email, passwordResetLink });
    }
    const emailed = mailResult.ok === true;
    const exposeLink = !emailed || process.env.INVITE_EXPOSE_LINK === "true";
    /** Returned to the client so the email log entry shows who sent it when SMTP delivery is used. */
    const smtpFrom = (process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();

    res.status(201).json({
      ok: true,
      emailed,
      preferMailboxDelivery: preferMailbox,
      graphInvite: { subject: inviteSubject, html: inviteHtml },
      ...(emailed && smtpFrom ? { smtpFrom } : {}),
      ...(mailResult.reason ? { emailNotice: mailResult.reason } : {}),
      ...(exposeLink ? { passwordResetLink } : {})
    });
  } catch (e) {
    return res.status(500).json({
      error: `Could not prepare Firebase user or password link: ${e.message || "Firebase error"}. Enable Email/Password in Firebase Authentication.`
    });
  }
}

async function listUsers(req, res) {
  const actor = req.ct;
  if (actor.role === "member") {
    return res.status(403).json({ error: "Forbidden" });
  }
  let companyId = actor.companyId;
  if (actor.role === "super_admin") {
    const q = req.query.companyId != null ? Number(req.query.companyId) : NaN;
    if (Number.isInteger(q) && q > 0) companyId = q;
    else {
      try {
        companyId = require("../config/activeCompany").getActiveCompanyId();
      } catch {
        return res.status(400).json({ error: "Pass companyId query or set DEFAULT_COMPANY_ID." });
      }
    }
  }

  const profiles = await listUsersForCompany(companyId);
  const companyName = await getCompanyName(companyId);

  const users = profiles.map((p) => ({
    id: p.uid,
    email: p.email,
    displayName: p.displayName,
    companyId: p.companyId,
    companyName,
    role: p.role,
    propertyIds: p.propertyIds,
    lastLoginAt: p.lastLoginAt ?? null,
    accountCreatedAt: p.accountCreatedAt ?? null,
    invitationPending: Boolean(p.invitationPending),
    active: Boolean(p.active),
    disabled: Boolean(p.disabled)
  }));

  res.json({ users });
}

async function patchUser(req, res) {
  const actor = req.ct;
  if (actor.role === "member") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const targetUid = String(req.params.uid || req.params.id || "").trim();
  if (!targetUid) {
    return res.status(400).json({ error: "invalid user id" });
  }

  try {
    const fresh = await patchUserClaims(actor, targetUid, req.body || {});
    const tokenNote =
      actor.firebaseUid !== targetUid
        ? " The user must sign out and sign in again (or wait up to ~1 hour) for all changes to apply to their session."
        : " Refresh your session (sign out/in) if the app still shows old permissions.";
    res.json({
      user: {
        id: fresh.uid,
        email: fresh.email,
        displayName: fresh.displayName,
        companyId: Number(fresh.companyId),
        role: String(fresh.role || "member").toLowerCase()
      },
      message: tokenNote.trim()
    });
  } catch (e) {
    const code = e.statusCode || 500;
    if (code === 404) return res.status(404).json({ error: "not found" });
    if (code === 403) return res.status(403).json({ error: e.message || "Forbidden" });
    if (code === 400) return res.status(400).json({ error: e.message || "Bad request" });
    throw e;
  }
}

async function listPropertyOptions(req, res) {
  const actor = req.ct;
  if (actor.role === "member") {
    return res.status(403).json({ error: "Forbidden" });
  }
  let companyId = actor.companyId;
  if (actor.role === "super_admin") {
    const q = req.query.companyId != null ? Number(req.query.companyId) : NaN;
    if (Number.isInteger(q) && q > 0) companyId = q;
    else {
      try {
        companyId = require("../config/activeCompany").getActiveCompanyId();
      } catch {
        return res.status(400).json({ error: "companyId query required" });
      }
    }
  }
  const result = await query(
    `SELECT pr.Id AS id, pr.Name AS name,
            p.Id AS portfolioId, p.Name AS portfolioName,
            r.Id AS regionId, r.Name AS regionName
     FROM dbo.Properties pr
     INNER JOIN dbo.Portfolios p ON p.Id = pr.PortfolioId AND p.CompanyId = pr.CompanyId
     INNER JOIN dbo.Regions r ON r.Id = p.RegionId AND r.CompanyId = pr.CompanyId
     WHERE pr.CompanyId = @companyId
     ORDER BY r.Name, p.Name, pr.Name`,
    { companyId: { type: sql.Int, value: companyId } }
  );
  res.json({
    properties: (result.recordset || []).map((row) => ({
      id: row.Id ?? row.id,
      name: row.Name ?? row.name ?? "",
      portfolioId: row.portfolioId ?? row.PortfolioId ?? null,
      portfolioName: row.portfolioName ?? row.PortfolioName ?? "",
      regionId: row.regionId ?? row.RegionId ?? null,
      regionName: row.regionName ?? row.RegionName ?? ""
    }))
  });
}

module.exports = { getMe, postInvite, listUsers, patchUser, listPropertyOptions };
