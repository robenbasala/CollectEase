const { readCompanyContext } = require("./companyContext");

function parsePositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resolves active company from token + query (super admin) and ensures route/body company matches.
 * @returns {number|null}
 */
function requireCompanyScope(req, res, explicitCompanyId) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return null;
  const cid = parsePositiveInt(explicitCompanyId);
  if (!cid) {
    res.status(400).json({ error: "Invalid company id" });
    return null;
  }
  if (cid !== ctx.companyId) {
    res.status(403).json({ error: "companyId is not allowed for this session." });
    return null;
  }
  return cid;
}

module.exports = { requireCompanyScope, parsePositiveInt };
