const { sql, query } = require("../db");
const { countProvisionedUsersByCompanyId } = require("../services/authTenant");

const DATA_SOURCES = new Set(["Yardi", "Appfolio", "Landlord"]);

function normalizeDataSource(raw) {
  if (raw == null || raw === "") return null;
  const v = String(raw).trim();
  if (!DATA_SOURCES.has(v)) return false;
  return v;
}

function mapCompanyRow(row, userCounts) {
  const id = row.Id ?? row.id;
  const nid = Number(id);
  return {
    id,
    name: row.Name ?? row.name ?? "",
    dataSource: row.DataSource ?? row.dataSource ?? null,
    userCount: Number(userCounts.get(nid) ?? 0),
    regionCount: Number(row.RegionCount ?? row.regionCount ?? 0),
    portfolioCount: Number(row.PortfolioCount ?? row.portfolioCount ?? 0),
    propertyCount: Number(row.PropertyCount ?? row.propertyCount ?? 0)
  };
}

async function listCompanies(req, res) {
  const role = req.ct?.role;
  const selectAgg = `SELECT c.Id, c.Name, c.DataSource,
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
  const dataSource = normalizeDataSource(req.body?.dataSource);
  if (dataSource === false) {
    return res.status(400).json({ error: "dataSource must be Yardi, Appfolio, or Landlord" });
  }
  try {
    const result = await query(
      `INSERT INTO dbo.Companies (Name, DataSource)
       OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.DataSource
       VALUES (@name, @dataSource)`,
      {
        name: { type: sql.NVarChar(200), value: name.slice(0, 200) },
        dataSource: { type: sql.NVarChar(50), value: dataSource }
      }
    );
    const row = result.recordset[0];
    res.status(201).json({
      company: {
        id: row.Id ?? row.id,
        name: row.Name ?? row.name,
        dataSource: row.DataSource ?? row.dataSource ?? null
      }
    });
  } catch (e) {
    if (/UQ_Companies_Name|UNIQUE KEY/i.test(String(e.message || ""))) {
      return res.status(409).json({ error: "A company with this name already exists." });
    }
    throw e;
  }
}

async function updateCompany(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid company id" });
  }
  const name = req.body?.name != null ? String(req.body.name).trim() : "";
  if (!name) return res.status(400).json({ error: "name is required" });
  const hasDataSource = Object.prototype.hasOwnProperty.call(req.body || {}, "dataSource");
  const dataSource = hasDataSource ? normalizeDataSource(req.body.dataSource) : undefined;
  if (dataSource === false) {
    return res.status(400).json({ error: "dataSource must be Yardi, Appfolio, or Landlord" });
  }
  try {
    const result = await query(
      `UPDATE dbo.Companies
       SET Name = @name${hasDataSource ? ", DataSource = @dataSource" : ""}
       OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.DataSource
       WHERE Id = @id`,
      {
        id: { type: sql.Int, value: id },
        name: { type: sql.NVarChar(200), value: name.slice(0, 200) },
        ...(hasDataSource ? { dataSource: { type: sql.NVarChar(50), value: dataSource } } : {})
      }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: "company not found" });
    return res.json({
      company: {
        id: row.Id ?? row.id,
        name: row.Name ?? row.name,
        dataSource: row.DataSource ?? row.dataSource ?? null
      }
    });
  } catch (e) {
    if (/UQ_Companies_Name|UNIQUE KEY/i.test(String(e.message || ""))) {
      return res.status(409).json({ error: "A company with this name already exists." });
    }
    throw e;
  }
}

async function deleteCompany(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid company id" });
  }

  let userCounts = new Map();
  try {
    userCounts = await countProvisionedUsersByCompanyId();
  } catch (e) {
    console.error("deleteCompany: Firebase user counts failed", e?.message || e);
  }
  const provisionedUsers = Number(userCounts.get(id) ?? 0);
  if (provisionedUsers > 0) {
    return res.status(409).json({
      error: `Cannot delete this company while ${provisionedUsers} provisioned user(s) are assigned to it.`
    });
  }

  const deps = await query(
    `SELECT
       (SELECT COUNT(*) FROM dbo.Regions WHERE CompanyId = @id) AS RegionCount,
       (SELECT COUNT(*) FROM dbo.Portfolios WHERE CompanyId = @id) AS PortfolioCount,
       (SELECT COUNT(*) FROM dbo.Properties WHERE CompanyId = @id) AS PropertyCount,
       (SELECT COUNT(*) FROM dbo.CompanyCollectionSettings WHERE CompanyId = @id) AS SettingsCount`,
    { id: { type: sql.Int, value: id } }
  );
  const row = deps.recordset?.[0] || {};
  const regionCount = Number(row.RegionCount ?? 0);
  const portfolioCount = Number(row.PortfolioCount ?? 0);
  const propertyCount = Number(row.PropertyCount ?? 0);
  const settingsCount = Number(row.SettingsCount ?? 0);

  if (regionCount > 0 || portfolioCount > 0 || propertyCount > 0 || settingsCount > 0) {
    return res.status(409).json({
      error:
        "Cannot delete this company while it still has related data (regions, portfolios, properties, or settings)."
    });
  }

  const result = await query(`DELETE FROM dbo.Companies WHERE Id = @id`, {
    id: { type: sql.Int, value: id }
  });
  if (Number(result.rowsAffected?.[0] || 0) === 0) {
    return res.status(404).json({ error: "company not found" });
  }
  return res.status(204).send();
}

module.exports = { listCompanies, createCompany, updateCompany, deleteCompany };
