const { getFirebaseAuth } = require("../lib/firebaseAdmin");
const { buildTenantContext } = require("../services/authTenant");

async function verifyFirebaseIdToken(req, res, next) {
  const hdr = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (!m) {
    return res.status(401).json({ error: "Missing or invalid Authorization header (Bearer token required)." });
  }
  const idToken = m[1].trim();
  if (!idToken) {
    return res.status(401).json({ error: "Empty ID token." });
  }
  try {
    const auth = getFirebaseAuth();
    const decoded = await auth.verifyIdToken(idToken, true);
    req.firebase = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      decoded
    };
    return next();
  } catch (e) {
    const msg = process.env.NODE_ENV !== "production" ? e.message : "Invalid or expired token";
    return res.status(401).json({ error: msg });
  }
}

async function attachRegisteredUser(req, res, next) {
  if (!req.firebase) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const ct = await buildTenantContext(req.firebase.decoded || null);
    if (!ct) {
      return res.status(403).json({
        error: "No active invitation for this email. Ask an administrator to invite you.",
        code: "NEEDS_INVITATION"
      });
    }
    req.ct = ct;
    return next();
  } catch (e) {
    return next(e);
  }
}

function requireCompanyAdmin(req, res, next) {
  const r = req.ct?.role;
  if (r === "super_admin" || r === "company_admin") return next();
  return res.status(403).json({ error: "Company administrator access required." });
}

function requireSuperAdmin(req, res, next) {
  if (req.ct?.role === "super_admin") return next();
  return res.status(403).json({ error: "Super administrator access required." });
}

module.exports = {
  verifyFirebaseIdToken,
  attachRegisteredUser,
  requireCompanyAdmin,
  requireSuperAdmin
};
