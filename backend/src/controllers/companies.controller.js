const { sql, query } = require("../db");
const { countProvisionedUsersByCompanyId } = require("../services/authTenant");

function mapCompanyRow(row, userCounts) {
  const id = row.Id ?? row.id;
  const nid = Number(id);
  return {
    id,
    name: row.Name ?? row.name ?? "",
    userCount: Number(userCounts.get(nid) ?? 0),
    regionCount: Number(row.RegionCount ?? row.regionCount ?? 0),
    portfolioCount: Number(row.PortfolioCount ?? row.portfolioCount ?? 0),
    propertyCount: Number(row.PropertyCount ?? row.propertyCount ?? 0)
  };
}

async function listCompanies(req, res) {
  const role = req.ct?.role;
  const selectAgg = `SELECT c.Id, c.Name,
    (SELECT COUNT(*) FROM dbo.Regions r WHERE r.CompanyId = c.Id) AS RegionCount,
    (SELECT COUNT(*) FROM dbo.Portfolios p WHERE p.CompanyId = c.Id) AS PortfolioCount,
    (SELECT COUNT(*) FROM dbo.Properties pr WHERE pr.CompanyId = c.Id) AS PropertyCount
    FROM dbo.Companies c`;

  let userCounts = new Map();
  try {
    userCounts = await countProvisionedUsersByCompanyId();
  } catch (e) {
    console.error("listCompanies: Firebase user counts failed", e?.message || e);
  }

  if (role === "super_admin") {
    const result = await query(`${selectAgg} ORDER BY c.Name`);
    return res.json({
      companies: (result.recordset || []).map((row) => mapCompanyRow(row, userCounts))
    });
  }
  const cid = req.ct?.companyId;
  const result = await query(`${selectAgg} WHERE c.Id = @cid ORDER BY c.Name`, {
    cid: { type: sql.Int, value: cid }
  });
  res.json({
    companies: (result.recordset || []).map((row) => mapCompanyRow(row, userCounts))
  });
}

async function createCompany(req, res) {
  const name = req.body?.name != null ? String(req.body.name).trim() : "";
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const result = await query(
      `INSERT INTO dbo.Companies (Name) OUTPUT INSERTED.Id, INSERTED.Name VALUES (@name)`,
      { name: { type: sql.NVarChar(200), value: name.slice(0, 200) } }
    );
    const row = result.recordset[0];
    res.status(201).json({ company: { id: row.Id ?? row.id, name: row.Name ?? row.name } });
  } catch (e) {
    if (/UQ_Companies_Name|UNIQUE KEY/i.test(String(e.message || ""))) {
      return res.status(409).json({ error: "A company with this name already exists." });
    }
    throw e;
  }
}

module.exports = { listCompanies, createCompany };
