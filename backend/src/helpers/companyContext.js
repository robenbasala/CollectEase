const { sql } = require("../db");
const { getActiveCompanyId } = require("../config/activeCompany");
const col = require("./columnMap");

const DT_PR = `[${col.property}]`;

/**
 * @returns {{ companyId: number, allowedPropertyNames: string[]|null, role: string, userId: string } | null}
 */
function readCompanyContext(req, res) {
  if (!req.ct) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  let companyId = req.ct.companyId;
  if (req.ct.role === "super_admin") {
    const raw = req.query?.companyId ?? req.headers["x-company-id"];
    const n = raw != null ? Number(String(raw).trim()) : NaN;
    if (Number.isInteger(n) && n > 0) {
      companyId = n;
    } else {
      try {
        companyId = getActiveCompanyId();
      } catch {
        res.status(500).json({ error: "DEFAULT_COMPANY_ID is not set for super admin context." });
        return null;
      }
    }
  }
  return {
    companyId,
    allowedPropertyNames: req.ct.allowedPropertyNames,
    role: req.ct.role,
    userId: req.ct.userId
  };
}

function intersectRequestedProperties(ctx, requested) {
  const norm = [...new Set(requested.map((p) => String(p).trim()).filter(Boolean))];
  if (ctx.role === "super_admin" || ctx.role === "company_admin") return norm;
  if (!ctx.allowedPropertyNames || ctx.allowedPropertyNames.length === 0) return [];
  const allow = new Set(ctx.allowedPropertyNames.map((p) => String(p).trim()));
  return norm.filter((p) => allow.has(p));
}

/** Scope DataTbl rows by property name (members only). Mutates `inputs` with @scopeP0… */
function dataTblPropertyScopeSql(ctx, inputs, keyPrefix = "scopeP") {
  if (ctx.role === "super_admin" || ctx.role === "company_admin") return "";
  const names = ctx.allowedPropertyNames;
  if (!names || names.length === 0) return " AND 1=0 ";
  const parts = [];
  names.forEach((name, i) => {
    const k = `${keyPrefix}${i}`;
    inputs[k] = { type: sql.NVarChar(400), value: String(name).trim() };
    parts.push(`@${k}`);
  });
  return ` AND LTRIM(RTRIM(CAST(dt.${DT_PR} AS NVARCHAR(400)))) IN (${parts.join(", ")}) `;
}

/** Scope dbo.Properties rows (alias `pr`) for region/portfolio/property pickers. */
function propertiesTableScopeSql(ctx, inputs, prAlias = "pr", keyPrefix = "scopePr") {
  if (ctx.role === "super_admin" || ctx.role === "company_admin") return "";
  const names = ctx.allowedPropertyNames;
  if (!names || names.length === 0) return " AND 1=0 ";
  const parts = [];
  names.forEach((name, i) => {
    const k = `${keyPrefix}${i}`;
    inputs[k] = { type: sql.NVarChar(400), value: String(name).trim() };
    parts.push(`@${k}`);
  });
  return ` AND LTRIM(RTRIM(CAST(${prAlias}.Name AS NVARCHAR(400)))) IN (${parts.join(", ")}) `;
}

function memberCanAccessProperty(ctx, propertyName) {
  if (ctx.role === "super_admin" || ctx.role === "company_admin") return true;
  const p = String(propertyName || "").trim();
  if (!ctx.allowedPropertyNames || ctx.allowedPropertyNames.length === 0) return false;
  return ctx.allowedPropertyNames.some((x) => String(x).trim() === p);
}

module.exports = {
  readCompanyContext,
  intersectRequestedProperties,
  dataTblPropertyScopeSql,
  propertiesTableScopeSql,
  memberCanAccessProperty
};
