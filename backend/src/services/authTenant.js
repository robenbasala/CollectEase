/**
 * Authorization lives in Firebase Authentication custom claims on each user (no Firestore).
 * Claims: ctRole, ctCompanyId, ctPropertyIds (numeric ids for members only).
 */
const { getFirebaseAuth } = require("../lib/firebaseAdmin");
const { sql, query } = require("../db");
const { getActiveCompanyId } = require("../config/activeCompany");
const { normEmail, parseSuperAdminEmails } = require("../utils/email");

async function loadPropertyNamesFromIds(companyId, propertyIds) {
  const ids = (Array.isArray(propertyIds) ? propertyIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  const ph = ids.map((_, i) => `@ip${i}`).join(", ");
  const inputs = { companyId: { type: sql.Int, value: companyId } };
  ids.forEach((id, i) => {
    inputs[`ip${i}`] = { type: sql.Int, value: id };
  });
  const ok = await query(
    `SELECT Name AS n FROM dbo.Properties WHERE CompanyId = @companyId AND Id IN (${ph}) ORDER BY Name`,
    inputs
  );
  return (ok.recordset || []).map((r) => String(r.n ?? "").trim()).filter(Boolean);
}

async function validatePropertyIdsForCompany(companyId, propertyIds) {
  const ids = (Array.isArray(propertyIds) ? propertyIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  const ph = ids.map((_, i) => `@vp${i}`).join(", ");
  const inputs = { cid: { type: sql.Int, value: companyId } };
  ids.forEach((id, i) => {
    inputs[`vp${i}`] = { type: sql.Int, value: id };
  });
  const chk = await query(
    `SELECT COUNT(1) AS c FROM dbo.Properties WHERE CompanyId = @cid AND Id IN (${ph})`,
    inputs
  );
  const c = Number(chk.recordset[0]?.c ?? 0);
  if (c !== ids.length) return null;
  return ids;
}

async function getCompanyName(companyId) {
  const r = await query(`SELECT Name FROM dbo.Companies WHERE Id = @id`, {
    id: { type: sql.Int, value: companyId }
  });
  const row = r.recordset[0];
  return row ? String(row.Name ?? row.name ?? "").trim() : "";
}

async function consumePendingInvitation(email, companyId) {
  try {
    await query(
      `UPDATE dbo.UserInvitation
       SET ConsumedAt = SYSUTCDATETIME()
       WHERE Email = @email
         AND CompanyId = @companyId
         AND ConsumedAt IS NULL`,
      {
        email: { type: sql.NVarChar(320), value: normEmail(email) },
        companyId: { type: sql.Int, value: companyId }
      }
    );
  } catch (e) {
    if (/Invalid object name/i.test(String(e?.message || ""))) return;
    throw e;
  }
}

async function getPendingInvitationEmailSet(companyId) {
  try {
    const result = await query(
      `SELECT Email
       FROM dbo.UserInvitation
       WHERE CompanyId = @companyId
         AND ConsumedAt IS NULL`,
      { companyId: { type: sql.Int, value: companyId } }
    );
    return new Set((result.recordset || []).map((r) => normEmail(r.Email ?? r.email)).filter(Boolean));
  } catch (e) {
    if (/Invalid object name/i.test(String(e?.message || ""))) return new Set();
    throw e;
  }
}

function readClaimsFromDecoded(decoded) {
  if (!decoded || typeof decoded !== "object") {
    return { role: null, companyId: null, propertyIds: [] };
  }
  const role = decoded.ctRole != null ? String(decoded.ctRole).toLowerCase().trim() : null;
  const companyId = decoded.ctCompanyId != null ? Number(decoded.ctCompanyId) : null;
  const raw = decoded.ctPropertyIds;
  const propertyIds = Array.isArray(raw) ? raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : [];
  return { role: role || null, companyId, propertyIds };
}

async function setClaimsForUid(uid, { role, companyId, propertyIds }) {
  const auth = getFirebaseAuth();
  await auth.setCustomUserClaims(String(uid), {
    ctRole: role,
    ctCompanyId: companyId,
    ctPropertyIds: Array.isArray(propertyIds) ? propertyIds : []
  });
}

/**
 * Build req.ct from verified ID token + custom claims (and SQL property names for members).
 * @param {import('firebase-admin/auth').DecodedIdToken} decoded
 */
async function buildTenantContext(decoded) {
  if (!decoded || typeof decoded !== "object") {
    return null;
  }
  const uid = String(decoded.uid || "");
  const email = normEmail(decoded.email);
  if (!uid || !email) return null;

  const auth = getFirebaseAuth();
  const supers = parseSuperAdminEmails();

  if (supers.includes(email)) {
    let { companyId } = readClaimsFromDecoded(decoded);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      try {
        companyId = getActiveCompanyId();
      } catch {
        companyId = 1;
      }
    }
    const cur = readClaimsFromDecoded(decoded);
    if (cur.role !== "super_admin") {
      await setClaimsForUid(uid, { role: "super_admin", companyId, propertyIds: [] });
    }
    return {
      userId: uid,
      firebaseUid: uid,
      email: decoded.email || email,
      displayName: null,
      companyId,
      role: "super_admin",
      allowedPropertyNames: null
    };
  }

  const { role, companyId, propertyIds } = readClaimsFromDecoded(decoded);
  if (!role || !["company_admin", "member", "super_admin"].includes(role)) {
    return null;
  }
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return null;
  }

  let allowedPropertyNames = null;
  if (role === "member") {
    if (propertyIds.length === 0) return null;
    allowedPropertyNames = await loadPropertyNamesFromIds(companyId, propertyIds);
    if (!allowedPropertyNames.length) return null;
  } else {
    allowedPropertyNames = null;
  }

  await consumePendingInvitation(email, companyId);

  return {
    userId: uid,
    firebaseUid: uid,
    email: decoded.email || email,
    displayName: null,
    companyId,
    role,
    allowedPropertyNames: role === "company_admin" || role === "super_admin" ? null : allowedPropertyNames
  };
}

/** True if this email already has ctRole in Firebase Auth. */
async function userAlreadyProvisioned(emailNorm) {
  const auth = getFirebaseAuth();
  try {
    const u = await auth.getUserByEmail(emailNorm);
    const c = u.customClaims || {};
    return Boolean(c.ctRole);
  } catch (e) {
    if (e.code === "auth/user-not-found") return false;
    throw e;
  }
}

function mapAuthUserRecord(u) {
  const c = u.customClaims || {};
  const r = String(c.ctRole || "").toLowerCase();
  const meta = u.metadata || {};
  return {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || null,
    companyId: c.ctCompanyId != null ? Number(c.ctCompanyId) : null,
    role: r,
    propertyIds: r === "member" && Array.isArray(c.ctPropertyIds) ? c.ctPropertyIds.map((x) => Number(x)) : [],
    lastLoginAt: meta.lastSignInTime || null,
    accountCreatedAt: meta.creationTime || null,
    disabled: u.disabled === true
  };
}

async function listUsersForCompany(companyId) {
  const auth = getFirebaseAuth();
  const pendingInvites = await getPendingInvitationEmailSet(companyId);
  const out = [];
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const u of result.users) {
      const c = u.customClaims || {};
      if (!c.ctRole) continue;
      const cid = Number(c.ctCompanyId);
      if (cid === Number(companyId)) {
        const row = mapAuthUserRecord(u);
        const pendingInvitation = pendingInvites.has(normEmail(row.email));
        out.push({
          ...row,
          invitationPending: pendingInvitation,
          active: row.disabled !== true && !pendingInvitation
        });
      }
    }
    pageToken = result.pageToken;
  } while (pageToken);
  out.sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return out;
}

async function patchUserClaims(actor, targetUid, body) {
  const auth = getFirebaseAuth();
  let target;
  try {
    target = await auth.getUser(targetUid);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      const err = new Error("not found");
      err.statusCode = 404;
      throw err;
    }
    throw e;
  }

  const c = target.customClaims || {};
  const targetCompanyId = Number(c.ctCompanyId);
  const targetRole = String(c.ctRole || "member").toLowerCase();

  if (actor.role === "company_admin") {
    if (targetCompanyId !== actor.companyId) {
      const err = new Error("Forbidden");
      err.statusCode = 403;
      throw err;
    }
    if (targetRole === "super_admin") {
      const err = new Error("Cannot edit super admin");
      err.statusCode = 403;
      throw err;
    }
  } else if (actor.role !== "super_admin") {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  let ctRole = body.role != null ? String(body.role).toLowerCase() : targetRole;
  let ctCompanyId = body.companyId != null ? Number(body.companyId) : targetCompanyId;
  let ctPropertyIds = Array.isArray(c.ctPropertyIds)
    ? c.ctPropertyIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  if (body.companyId != null && actor.role === "super_admin") {
    const nc = Number(body.companyId);
    if (Number.isInteger(nc) && nc > 0) ctCompanyId = nc;
  }

  if (body.role != null) {
    if (ctRole === "member" && !Array.isArray(body.propertyIds)) {
      const err = new Error("propertyIds required when setting role to member");
      err.statusCode = 400;
      throw err;
    }
    if (actor.role === "company_admin") {
      if (ctRole === "super_admin") {
        const err = new Error("Cannot promote to super_admin");
        err.statusCode = 403;
        throw err;
      }
      if (ctRole !== "company_admin" && ctRole !== "member") {
        const err = new Error("Invalid role");
        err.statusCode = 400;
        throw err;
      }
    } else if (actor.role === "super_admin") {
      if (!["super_admin", "company_admin", "member"].includes(ctRole)) {
        const err = new Error("Invalid role");
        err.statusCode = 400;
        throw err;
      }
    }
    if (ctRole === "company_admin" || ctRole === "super_admin") {
      ctPropertyIds = [];
    }
  }

  if (Array.isArray(body.propertyIds)) {
    if (ctRole !== "member") {
      ctPropertyIds = [];
    } else {
      const pids = body.propertyIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
      if (pids.length === 0) {
        const err = new Error("member users need at least one property");
        err.statusCode = 400;
        throw err;
      }
      const valid = await validatePropertyIdsForCompany(ctCompanyId, pids);
      if (valid == null) {
        const err = new Error("Invalid property ids");
        err.statusCode = 400;
        throw err;
      }
      ctPropertyIds = valid;
    }
  }

  await auth.setCustomUserClaims(targetUid, {
    ctRole,
    ctCompanyId,
    ctPropertyIds
  });

  const fresh = await auth.getUser(targetUid);
  return mapAuthUserRecord(fresh);
}

/**
 * Firebase users with ctRole set, grouped by ctCompanyId (provisioned app users).
 * @returns {Promise<Map<number, number>>}
 */
async function countProvisionedUsersByCompanyId() {
  const auth = getFirebaseAuth();
  /** @type {Map<number, number>} */
  const counts = new Map();
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const u of result.users) {
      const c = u.customClaims || {};
      if (!c.ctRole) continue;
      const cid = Number(c.ctCompanyId);
      if (!Number.isInteger(cid) || cid <= 0) continue;
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    pageToken = result.pageToken;
  } while (pageToken);
  return counts;
}

module.exports = {
  buildTenantContext,
  loadPropertyNamesFromIds,
  validatePropertyIdsForCompany,
  getCompanyName,
  userAlreadyProvisioned,
  setClaimsForUid,
  listUsersForCompany,
  patchUserClaims,
  countProvisionedUsersByCompanyId
};
