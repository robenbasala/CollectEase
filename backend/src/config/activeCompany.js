require("dotenv").config();

/**
 * Single source for the active tenant company id.
 * Today: DEFAULT_COMPANY_ID in .env — later can read session/JWT/header here.
 */
function getActiveCompanyId() {
  const raw = process.env.DEFAULT_COMPANY_ID;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new Error("DEFAULT_COMPANY_ID is not set in environment");
  }
  const id = Number(String(raw).trim());
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("DEFAULT_COMPANY_ID must be a positive integer");
  }
  return id;
}

/** Use in Express handlers; sends JSON error and returns null on failure. */
function readActiveCompanyId(res) {
  try {
    return getActiveCompanyId();
  } catch (err) {
    res.status(500).json({ error: err.message });
    return null;
  }
}

module.exports = { getActiveCompanyId, readActiveCompanyId };
