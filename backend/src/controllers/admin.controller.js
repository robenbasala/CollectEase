const { sql, query } = require("../db");
const { readActiveCompanyId } = require("../config/activeCompany");
const {
  normalizeUnitDetailColumnPrefs,
  parsePrefsJson
} = require("../helpers/unitDetailColumnPrefs");

/** tedious/mssql may return PascalCase or lowercase keys depending on server/driver */
function rowRegion(r) {
  return {
    id: r.Id ?? r.id,
    name: r.Name ?? r.name ?? "",
    companyId: r.CompanyId ?? r.companyId
  };
}

function rowPortfolio(r) {
  return {
    id: r.Id ?? r.id,
    regionId: r.RegionId ?? r.regionId,
    name: r.Name ?? r.name ?? "",
    companyId: r.CompanyId ?? r.companyId
  };
}

function rowProperty(r) {
  return {
    id: r.Id ?? r.id,
    portfolioId: r.PortfolioId ?? r.portfolioId,
    name: r.Name ?? r.name ?? "",
    listName: r.ListName ?? r.listName ?? null,
    companyId: r.CompanyId ?? r.companyId
  };
}

async function regionBelongsToCompany(companyId, regionId) {
  const result = await query(
    `SELECT 1 AS ok FROM dbo.Regions WHERE Id = @regionId AND CompanyId = @companyId`,
    {
      regionId: { type: sql.Int, value: regionId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return result.recordset.length > 0;
}

async function portfolioBelongsToCompany(companyId, portfolioId) {
  const result = await query(
    `SELECT 1 AS ok
     FROM dbo.Portfolios p
     INNER JOIN dbo.Regions r ON p.RegionId = r.Id
     WHERE p.Id = @portfolioId AND r.CompanyId = @companyId`,
    {
      portfolioId: { type: sql.Int, value: portfolioId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return result.recordset.length > 0;
}

async function propertyBelongsToCompany(companyId, propertyId) {
  const result = await query(
    `SELECT 1 AS ok
     FROM dbo.Properties pr
     INNER JOIN dbo.Portfolios p ON pr.PortfolioId = p.Id
     INNER JOIN dbo.Regions r ON p.RegionId = r.Id
     WHERE pr.Id = @propertyId AND r.CompanyId = @companyId`,
    {
      propertyId: { type: sql.Int, value: propertyId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return result.recordset.length > 0;
}

function scalarCount(recordset) {
  if (!recordset?.length) return 0;
  const row = recordset[0];
  const v = row.cnt ?? row.Cnt ?? Object.values(row)[0];
  return Number(v) || 0;
}

function isForeignKeyViolation(err) {
  const code = err?.number ?? err?.originalError?.number ?? err?.code;
  if (code === 547) return true;
  return /REFERENCE constraint|foreign key|547/i.test(String(err?.message || ""));
}

async function listRegions(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const result = await query(
    `SELECT Id, Name, CompanyId FROM dbo.Regions WHERE CompanyId = @companyId ORDER BY Name`,
    { companyId: { type: sql.Int, value: companyId } }
  );
  res.json({ regions: result.recordset.map(rowRegion) });
}

async function createRegion(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const name = req.body?.name;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const result = await query(
    `INSERT INTO dbo.Regions (CompanyId, Name) OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.CompanyId VALUES (@companyId, @name)`,
    {
      companyId: { type: sql.Int, value: companyId },
      name: { type: sql.NVarChar(200), value: String(name).trim() }
    }
  );
  res.status(201).json({ region: rowRegion(result.recordset[0]) });
}

async function updateRegion(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const id = Number(req.params.id);
  const name = req.body?.name;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const result = await query(
    `UPDATE dbo.Regions SET Name = @name OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.CompanyId WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: companyId },
      name: { type: sql.NVarChar(200), value: String(name).trim() }
    }
  );
  if (!result.recordset.length) {
    return res.status(404).json({ error: "not found" });
  }
  res.json({ region: rowRegion(result.recordset[0]) });
}

async function deleteRegion(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!(await regionBelongsToCompany(companyId, id))) {
    return res.status(404).json({ error: "not found" });
  }

  const portfolios = await query(
    `SELECT COUNT(*) AS cnt FROM dbo.Portfolios WHERE RegionId = @id`,
    { id: { type: sql.Int, value: id } }
  );
  if (scalarCount(portfolios.recordset) > 0) {
    return res.status(409).json({
      error:
        "Cannot delete this region: it still has one or more portfolios. Delete those portfolios first."
    });
  }

  try {
    const result = await query(
      `DELETE FROM dbo.Regions OUTPUT DELETED.Id WHERE Id = @id AND CompanyId = @companyId`,
      {
        id: { type: sql.Int, value: id },
        companyId: { type: sql.Int, value: companyId }
      }
    );
    if (!result.recordset.length) {
      return res.status(404).json({ error: "not found" });
    }
    res.status(204).send();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return res.status(409).json({
        error:
          "Cannot delete this region because other records still depend on it. Remove dependent records first."
      });
    }
    throw err;
  }
}

async function listPortfolios(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const regionId = Number(req.query.regionId);
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return res.status(400).json({ error: "regionId is required" });
  }
  if (!(await regionBelongsToCompany(companyId, regionId))) {
    return res.status(404).json({ error: "region not found" });
  }
  const result = await query(
    `SELECT Id, RegionId, Name, CompanyId FROM dbo.Portfolios WHERE RegionId = @regionId ORDER BY Name`,
    { regionId: { type: sql.Int, value: regionId } }
  );
  res.json({ portfolios: result.recordset.map(rowPortfolio) });
}

async function createPortfolio(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const regionId = Number(req.body?.regionId);
  const name = req.body?.name;
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return res.status(400).json({ error: "regionId is required" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!(await regionBelongsToCompany(companyId, regionId))) {
    return res.status(404).json({ error: "region not found" });
  }
  const result = await query(
    `INSERT INTO dbo.Portfolios (RegionId, Name, CompanyId) OUTPUT INSERTED.Id, INSERTED.RegionId, INSERTED.Name, INSERTED.CompanyId
     VALUES (@regionId, @name, @companyId)`,
    {
      regionId: { type: sql.Int, value: regionId },
      name: { type: sql.NVarChar(200), value: String(name).trim() },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  res.status(201).json({ portfolio: rowPortfolio(result.recordset[0]) });
}

async function updatePortfolio(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const id = Number(req.params.id);
  const regionId = req.body?.regionId != null ? Number(req.body.regionId) : undefined;
  const name = req.body?.name;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!(await portfolioBelongsToCompany(companyId, id))) {
    return res.status(404).json({ error: "not found" });
  }
  if (regionId !== undefined) {
    if (!Number.isInteger(regionId) || regionId <= 0) {
      return res.status(400).json({ error: "invalid regionId" });
    }
    if (!(await regionBelongsToCompany(companyId, regionId))) {
      return res.status(404).json({ error: "region not found" });
    }
  }
  const inputs = {
    id: { type: sql.Int, value: id },
    name: { type: sql.NVarChar(200), value: String(name).trim() },
    companyId: { type: sql.Int, value: companyId }
  };
  let setSql = `Name = @name, CompanyId = @companyId`;
  if (regionId !== undefined) {
    setSql += `, RegionId = @regionId`;
    inputs.regionId = { type: sql.Int, value: regionId };
  }
  const result = await query(
    `UPDATE dbo.Portfolios SET ${setSql} OUTPUT INSERTED.Id, INSERTED.RegionId, INSERTED.Name, INSERTED.CompanyId WHERE Id = @id`,
    inputs
  );
  if (!result.recordset.length) {
    return res.status(404).json({ error: "not found" });
  }
  res.json({ portfolio: rowPortfolio(result.recordset[0]) });
}

async function deletePortfolio(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!(await portfolioBelongsToCompany(companyId, id))) {
    return res.status(404).json({ error: "not found" });
  }

  const props = await query(
    `SELECT COUNT(*) AS cnt FROM dbo.Properties WHERE PortfolioId = @id`,
    { id: { type: sql.Int, value: id } }
  );
  if (scalarCount(props.recordset) > 0) {
    return res.status(409).json({
      error:
        "Cannot delete this portfolio: it still has one or more properties. Delete those properties first."
    });
  }

  try {
    const result = await query(`DELETE FROM dbo.Portfolios OUTPUT DELETED.Id WHERE Id = @id`, {
      id: { type: sql.Int, value: id }
    });
    if (!result.recordset.length) {
      return res.status(404).json({ error: "not found" });
    }
    res.status(204).send();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return res.status(409).json({
        error:
          "Cannot delete this portfolio because other records still depend on it. Remove dependent records first."
      });
    }
    throw err;
  }
}

async function listProperties(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const portfolioId = Number(req.query.portfolioId);
  if (!Number.isInteger(portfolioId) || portfolioId <= 0) {
    return res.status(400).json({ error: "portfolioId is required" });
  }
  if (!(await portfolioBelongsToCompany(companyId, portfolioId))) {
    return res.status(404).json({ error: "portfolio not found" });
  }
  const result = await query(
    `SELECT Id, PortfolioId, Name, ListName, CompanyId FROM dbo.Properties WHERE PortfolioId = @portfolioId ORDER BY Name`,
    { portfolioId: { type: sql.Int, value: portfolioId } }
  );
  res.json({ properties: result.recordset.map(rowProperty) });
}

async function createProperty(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const portfolioId = Number(req.body?.portfolioId);
  const name = req.body?.name;
  const listName =
    req.body?.listName === undefined || req.body?.listName === null
      ? null
      : String(req.body.listName).trim() || null;
  if (!Number.isInteger(portfolioId) || portfolioId <= 0) {
    return res.status(400).json({ error: "portfolioId is required" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!(await portfolioBelongsToCompany(companyId, portfolioId))) {
    return res.status(404).json({ error: "portfolio not found" });
  }
  const result = await query(
    `INSERT INTO dbo.Properties (PortfolioId, Name, ListName, CompanyId)
     OUTPUT INSERTED.Id, INSERTED.PortfolioId, INSERTED.Name, INSERTED.ListName, INSERTED.CompanyId
     VALUES (@portfolioId, @name, @listName, @companyId)`,
    {
      portfolioId: { type: sql.Int, value: portfolioId },
      name: { type: sql.NVarChar(200), value: String(name).trim() },
      listName: { type: sql.NVarChar(100), value: listName },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  res.status(201).json({ property: rowProperty(result.recordset[0]) });
}

async function updateProperty(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const id = Number(req.params.id);
  const portfolioId =
    req.body?.portfolioId != null ? Number(req.body.portfolioId) : undefined;
  const name = req.body?.name;
  const listName =
    req.body?.listName === undefined
      ? undefined
      : req.body?.listName === null
        ? null
        : String(req.body.listName).trim() || null;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!(await propertyBelongsToCompany(companyId, id))) {
    return res.status(404).json({ error: "not found" });
  }
  if (portfolioId !== undefined) {
    if (!Number.isInteger(portfolioId) || portfolioId <= 0) {
      return res.status(400).json({ error: "invalid portfolioId" });
    }
    if (!(await portfolioBelongsToCompany(companyId, portfolioId))) {
      return res.status(404).json({ error: "portfolio not found" });
    }
  }
  const inputs = {
    id: { type: sql.Int, value: id },
    name: { type: sql.NVarChar(200), value: String(name).trim() },
    companyId: { type: sql.Int, value: companyId }
  };
  let setSql = `Name = @name, CompanyId = @companyId`;
  if (portfolioId !== undefined) {
    setSql += `, PortfolioId = @portfolioId`;
    inputs.portfolioId = { type: sql.Int, value: portfolioId };
  }
  if (listName !== undefined) {
    setSql += `, ListName = @listName`;
    inputs.listName = { type: sql.NVarChar(100), value: listName };
  }
  const result = await query(
    `UPDATE dbo.Properties SET ${setSql} OUTPUT INSERTED.Id, INSERTED.PortfolioId, INSERTED.Name, INSERTED.ListName, INSERTED.CompanyId WHERE Id = @id`,
    inputs
  );
  if (!result.recordset.length) {
    return res.status(404).json({ error: "not found" });
  }
  res.json({ property: rowProperty(result.recordset[0]) });
}

async function deleteProperty(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  if (!(await propertyBelongsToCompany(companyId, id))) {
    return res.status(404).json({ error: "not found" });
  }

  try {
    const result = await query(`DELETE FROM dbo.Properties OUTPUT DELETED.Id WHERE Id = @id`, {
      id: { type: sql.Int, value: id }
    });
    if (!result.recordset.length) {
      return res.status(404).json({ error: "not found" });
    }
    res.status(204).send();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return res.status(409).json({
        error:
          "Cannot delete this property because other records still depend on it. Remove dependent records first."
      });
    }
    throw err;
  }
}

const COMPANY_SETTINGS_KEYS = [
  "followupAmount",
  "followupDays",
  "followupMonths",
  "legalAlertAmount",
  "legalAlertDays",
  "legalAlertMonths",
  "erpStaticLink",
  "defaultLegalStatusList",
  "logoDataUrl",
  "companyDisplayName"
];

function rowCompanySettings(r, companyId) {
  if (!r) {
    return {
      companyId: companyId ?? null,
      followupAmount: null,
      followupDays: null,
      followupMonths: null,
      legalAlertAmount: null,
      legalAlertDays: null,
      legalAlertMonths: null,
      erpStaticLink: null,
      defaultLegalStatusList: null,
      logoDataUrl: null,
      companyDisplayName: null
    };
  }
  const erpRaw = r.erpStaticLink ?? r.ErpStaticLink ?? r.erpstaticlink;
  return {
    companyId: r.CompanyId ?? r.companyId ?? companyId,
    followupAmount:
      r.FollowupAmount !== undefined && r.FollowupAmount !== null
        ? Number(r.FollowupAmount)
        : r.followupAmount !== undefined && r.followupAmount !== null
          ? Number(r.followupAmount)
          : null,
    followupDays:
      r.FollowupDays !== undefined && r.FollowupDays !== null
        ? Number(r.FollowupDays)
        : r.followupDays !== undefined && r.followupDays !== null
          ? Number(r.followupDays)
          : null,
    followupMonths:
      r.FollowupMonths !== undefined && r.FollowupMonths !== null
        ? Number(r.FollowupMonths)
        : r.followupMonths !== undefined && r.followupMonths !== null
          ? Number(r.followupMonths)
          : null,
    legalAlertAmount:
      r.LegalAlertAmount !== undefined && r.LegalAlertAmount !== null
        ? Number(r.LegalAlertAmount)
        : r.legalAlertAmount !== undefined && r.legalAlertAmount !== null
          ? Number(r.legalAlertAmount)
          : null,
    legalAlertDays:
      r.LegalAlertDays !== undefined && r.LegalAlertDays !== null
        ? Number(r.LegalAlertDays)
        : r.legalAlertDays !== undefined && r.legalAlertDays !== null
          ? Number(r.legalAlertDays)
          : null,
    legalAlertMonths:
      r.LegalAlertMonths !== undefined && r.LegalAlertMonths !== null
        ? Number(r.LegalAlertMonths)
        : r.legalAlertMonths !== undefined && r.legalAlertMonths !== null
          ? Number(r.legalAlertMonths)
          : null,
    erpStaticLink: erpRaw != null ? String(erpRaw) : null,
    defaultLegalStatusList: (() => {
      const v = r.defaultLegalStatusList ?? r.DefaultLegalStatusList ?? r.defaultlegalstatuslist;
      return v != null ? String(v) : null;
    })(),
    logoDataUrl: (() => {
      const v = r.logoDataUrl ?? r.LogoDataUrl ?? r.logodataurl;
      return v != null ? String(v) : null;
    })(),
    companyDisplayName: (() => {
      const v = r.companyDisplayName ?? r.CompanyDisplayName ?? r.companydisplayname;
      return v != null ? String(v) : null;
    })()
  };
}

async function getCompanySettings(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const result = await query(
    `SELECT CompanyId, FollowupAmount, FollowupDays, FollowupMonths,
            LegalAlertAmount, LegalAlertDays, LegalAlertMonths,
            ErpStaticLink AS erpStaticLink,
            DefaultLegalStatusList AS defaultLegalStatusList,
            LogoDataUrl AS logoDataUrl,
            CompanyDisplayName AS companyDisplayName
     FROM dbo.CompanyCollectionSettings WHERE CompanyId = @companyId`,
    { companyId: { type: sql.Int, value: companyId } }
  );
  const row = result.recordset[0];
  res.json({ settings: rowCompanySettings(row, companyId) });
}

function nullableDecimalFromBody(v) {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return n;
}

function nullableIntDayFromBody(v) {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return NaN;
  return n;
}

function nullableStringFromBody(v, maxLen) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (s.length > maxLen) return false;
  return s;
}

async function putCompanySettings(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const body = req.body || {};
  for (const k of COMPANY_SETTINGS_KEYS) {
    if (!(k in body)) {
      return res.status(400).json({ error: `Missing field: ${k}` });
    }
  }

  const fa = nullableDecimalFromBody(body.followupAmount);
  const fd = nullableIntDayFromBody(body.followupDays);
  const fm = nullableDecimalFromBody(body.followupMonths);
  const la = nullableDecimalFromBody(body.legalAlertAmount);
  const ld = nullableIntDayFromBody(body.legalAlertDays);
  const lm = nullableDecimalFromBody(body.legalAlertMonths);

  if (Number.isNaN(fa)) {
    return res.status(400).json({ error: "followupAmount must be a number or empty/null" });
  }
  if (Number.isNaN(fd) || (fd !== null && (fd < 1 || fd > 31))) {
    return res.status(400).json({ error: "followupDays must be an integer 1–31 or empty/null" });
  }
  if (Number.isNaN(fm) || (fm !== null && fm < 0)) {
    return res.status(400).json({ error: "followupMonths must be a number ≥ 0 or empty/null" });
  }
  if (Number.isNaN(la)) {
    return res.status(400).json({ error: "legalAlertAmount must be a number or empty/null" });
  }
  if (Number.isNaN(ld) || (ld !== null && (ld < 1 || ld > 31))) {
    return res.status(400).json({ error: "legalAlertDays must be an integer 1–31 or empty/null" });
  }
  if (Number.isNaN(lm) || (lm !== null && lm < 0)) {
    return res.status(400).json({ error: "legalAlertMonths must be a number ≥ 0 or empty/null" });
  }

  const erp = nullableStringFromBody(body.erpStaticLink, 2000);
  const legalList = nullableStringFromBody(body.defaultLegalStatusList, 200);
  const displayName = nullableStringFromBody(body.companyDisplayName, 200);
  if (erp === false) {
    return res.status(400).json({ error: "erpStaticLink is too long (max 2000)" });
  }
  if (legalList === false) {
    return res.status(400).json({ error: "defaultLegalStatusList is too long (max 200)" });
  }
  if (displayName === false) {
    return res.status(400).json({ error: "companyDisplayName is too long (max 200)" });
  }

  let logoDataUrl = body.logoDataUrl === null || body.logoDataUrl === "" ? null : String(body.logoDataUrl);
  if (logoDataUrl && logoDataUrl.length > 450000) {
    return res.status(400).json({ error: "logo image is too large" });
  }

  const inputs = {
    companyId: { type: sql.Int, value: companyId },
    followupAmount: { type: sql.Decimal(18, 4), value: fa },
    followupDays: { type: sql.Int, value: fd },
    followupMonths: { type: sql.Decimal(18, 4), value: fm },
    legalAlertAmount: { type: sql.Decimal(18, 4), value: la },
    legalAlertDays: { type: sql.Int, value: ld },
    legalAlertMonths: { type: sql.Decimal(18, 4), value: lm },
    erpStaticLink: { type: sql.NVarChar(2000), value: erp },
    defaultLegalStatusList: { type: sql.NVarChar(200), value: legalList },
    logoDataUrl: { type: sql.NVarChar(4001), value: logoDataUrl },
    companyDisplayName: { type: sql.NVarChar(200), value: displayName }
  };

  await query(
    `MERGE dbo.CompanyCollectionSettings AS t
     USING (SELECT @companyId AS CompanyId) AS s ON t.CompanyId = s.CompanyId
     WHEN MATCHED THEN
       UPDATE SET
         FollowupAmount = @followupAmount,
         FollowupDays = @followupDays,
         FollowupMonths = @followupMonths,
         LegalAlertAmount = @legalAlertAmount,
         LegalAlertDays = @legalAlertDays,
         LegalAlertMonths = @legalAlertMonths,
         ErpStaticLink = @erpStaticLink,
         DefaultLegalStatusList = @defaultLegalStatusList,
         LogoDataUrl = @logoDataUrl,
         CompanyDisplayName = @companyDisplayName
     WHEN NOT MATCHED THEN
       INSERT (
         CompanyId, FollowupAmount, FollowupDays, FollowupMonths,
         LegalAlertAmount, LegalAlertDays, LegalAlertMonths,
         ErpStaticLink, DefaultLegalStatusList, LogoDataUrl, CompanyDisplayName
       )
       VALUES (
         @companyId, @followupAmount, @followupDays, @followupMonths,
         @legalAlertAmount, @legalAlertDays, @legalAlertMonths,
         @erpStaticLink, @defaultLegalStatusList, @logoDataUrl, @companyDisplayName
       );`,
    inputs
  );

  const result = await query(
    `SELECT CompanyId, FollowupAmount, FollowupDays, FollowupMonths,
            LegalAlertAmount, LegalAlertDays, LegalAlertMonths,
            ErpStaticLink AS erpStaticLink,
            DefaultLegalStatusList AS defaultLegalStatusList,
            LogoDataUrl AS logoDataUrl,
            CompanyDisplayName AS companyDisplayName
     FROM dbo.CompanyCollectionSettings WHERE CompanyId = @companyId`,
    { companyId: { type: sql.Int, value: companyId } }
  );
  res.json({ settings: rowCompanySettings(result.recordset[0], companyId) });
}

async function getUnitDetailColumnPrefs(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  try {
    const result = await query(
      `SELECT UnitDetailColumnPrefs AS prefs
       FROM dbo.CompanyCollectionSettings WHERE CompanyId = @companyId`,
      { companyId: { type: sql.Int, value: companyId } }
    );
    const row = result.recordset[0];
    const rawPrefs = row?.prefs ?? row?.Prefs;
    const parsed = parsePrefsJson(rawPrefs);
    const normalized = normalizeUnitDetailColumnPrefs(parsed || {});
    return res.json({
      companyId,
      columnOrder: normalized.columnOrder,
      hidden: normalized.hidden
    });
  } catch (err) {
    if (/Invalid column name/i.test(String(err?.message || ""))) {
      const normalized = normalizeUnitDetailColumnPrefs({});
      return res.json({
        companyId,
        columnOrder: normalized.columnOrder,
        hidden: normalized.hidden
      });
    }
    throw err;
  }
}

async function putUnitDetailColumnPrefs(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const normalized = normalizeUnitDetailColumnPrefs(req.body || {});
  const json = JSON.stringify({
    columnOrder: normalized.columnOrder,
    hidden: normalized.hidden
  });
  if (json.length > 4000) {
    return res.status(400).json({ error: "column preferences JSON is too large (max 4000 characters)" });
  }

  try {
    await query(
      `MERGE dbo.CompanyCollectionSettings AS t
       USING (SELECT @companyId AS CompanyId) AS s ON t.CompanyId = s.CompanyId
       WHEN MATCHED THEN
         UPDATE SET UnitDetailColumnPrefs = @prefsJson
       WHEN NOT MATCHED THEN
         INSERT (CompanyId, UnitDetailColumnPrefs)
         VALUES (@companyId, @prefsJson);`,
      {
        companyId: { type: sql.Int, value: companyId },
        prefsJson: { type: sql.NVarChar(4000), value: json }
      }
    );
  } catch (err) {
    if (/Invalid column name/i.test(String(err?.message || ""))) {
      return res.status(503).json({
        error:
          "Database column UnitDetailColumnPrefs is missing. Run backend/scripts/migrate-unit-detail-column-prefs.sql"
      });
    }
    throw err;
  }

  res.json({
    companyId,
    columnOrder: normalized.columnOrder,
    hidden: normalized.hidden
  });
}

async function listPropertyListNames(req, res) {
  const companyId = readActiveCompanyId(res);
  if (companyId == null) return;

  const result = await query(
    `SELECT DISTINCT LTRIM(RTRIM(ListName)) AS value
     FROM dbo.Properties
     WHERE CompanyId = @companyId
       AND ListName IS NOT NULL
       AND LTRIM(RTRIM(ListName)) <> N''
     ORDER BY value`,
    { companyId: { type: sql.Int, value: companyId } }
  );
  const fromDb = result.recordset.map((r) => r.value).filter(Boolean);
  const presets = ["List1", "List2", "List3"];
  const merged = [...new Set([...presets, ...fromDb])];
  res.json({ listNames: merged });
}

module.exports = {
  listRegions,
  createRegion,
  updateRegion,
  deleteRegion,
  listPortfolios,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  listProperties,
  createProperty,
  updateProperty,
  deleteProperty,
  getCompanySettings,
  putCompanySettings,
  getUnitDetailColumnPrefs,
  putUnitDetailColumnPrefs,
  listPropertyListNames
};
