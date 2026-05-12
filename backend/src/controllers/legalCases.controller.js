/**
 * Legal case workflow per tenant unit:
 *   - One tenant unit may have many cases (each opened with year/month + note + follow-up).
 *   - Each case has many status entries (court history), with the most recent one driving the
 *     "latest legal status" badge shown on the main detail report.
 *   - Cases can be closed (sets ClosedAt) and reopened.
 *
 * Preset-scoped: each property chooses a preset list via dbo.Properties.ListName. The
 * Unit workspace modal loads legal status options from that selected preset.
 */
const { sql, query } = require("../db");
const { readCompanyContext, memberCanAccessProperty } = require("../helpers/companyContext");

function trimOrEmpty(v) {
  return v == null ? "" : String(v).trim();
}

function toIsoOrNull(v) {
  if (v == null || String(v).trim() === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Resolve the preset list chosen on a property. Falls back to company default, then List1. */
async function findLegalStatusListNameForProperty(companyId, propertyName) {
  const p = trimOrEmpty(propertyName);
  if (!p) return null;
  const result = await query(
    `SELECT TOP 1
        COALESCE(
          NULLIF(LTRIM(RTRIM(pr.ListName)), N''),
          NULLIF(LTRIM(RTRIM(cs.DefaultLegalStatusList)), N''),
          N'List1'
        ) AS ListName
     FROM dbo.Properties pr
     LEFT JOIN dbo.CompanyCollectionSettings cs ON cs.CompanyId = pr.CompanyId
     WHERE pr.CompanyId = @companyId AND LTRIM(RTRIM(pr.Name)) = @name`,
    {
      companyId: { type: sql.Int, value: companyId },
      name: { type: sql.NVarChar(400), value: p }
    }
  );
  const row = result.recordset?.[0];
  return row?.ListName ? String(row.ListName).trim() : null;
}

function rowCase(r) {
  return {
    id: Number(r.Id ?? r.id),
    property: r.PropertyName ?? r.propertyName ?? "",
    unit: r.Unit ?? r.unit ?? "",
    tenantName: r.TenantName ?? r.tenantName ?? "",
    tenantCode: r.TenantCode ?? r.tenantCode ?? "",
    openYear: r.OpenYear != null ? Number(r.OpenYear) : null,
    openMonth: r.OpenMonth != null ? Number(r.OpenMonth) : null,
    initialNote: r.InitialNote ?? r.initialNote ?? "",
    followUpAt:
      r.FollowUpAt instanceof Date
        ? r.FollowUpAt.toISOString()
        : r.FollowUpAt ?? null,
    isClosed: Boolean(r.IsClosed ?? r.isClosed),
    closedAt:
      r.ClosedAt instanceof Date ? r.ClosedAt.toISOString() : r.ClosedAt ?? null,
    createdAt:
      r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : r.CreatedAt ?? null,
    createdByName: r.CreatedByName ?? r.createdByName ?? "",
    latestStatus: r.LatestStatus ?? r.latestStatus ?? "",
    latestStatusAt:
      r.LatestStatusAt instanceof Date
        ? r.LatestStatusAt.toISOString()
        : r.LatestStatusAt ?? null,
    statusCount: r.StatusCount != null ? Number(r.StatusCount) : 0
  };
}

function rowStatus(r) {
  return {
    id: Number(r.Id ?? r.id),
    caseId: Number(r.CaseId ?? r.caseId),
    status: r.Status ?? r.status ?? "",
    note: r.Note ?? r.note ?? "",
    changedAt:
      r.ChangedAt instanceof Date ? r.ChangedAt.toISOString() : r.ChangedAt ?? null,
    createdByName: r.CreatedByName ?? r.createdByName ?? ""
  };
}

/** Validate row identity (property/unit/name) and return inputs object with tenantCode normalised. */
function validateRowIdentity(b, res) {
  const property = trimOrEmpty(b.property);
  const unit = trimOrEmpty(b.unit);
  const name = trimOrEmpty(b.name);
  if (!property || !unit || !name) {
    res.status(400).json({ error: "property, unit, and name are required" });
    return null;
  }
  const tenantCodeRaw = trimOrEmpty(b.tenantCode);
  return {
    property,
    unit,
    name,
    tenantCode: tenantCodeRaw === "" ? null : tenantCodeRaw
  };
}

async function listCases(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const property = trimOrEmpty(req.query.property);
  const unit = trimOrEmpty(req.query.unit);
  const name = trimOrEmpty(req.query.name);
  if (!property || !unit || !name) {
    return res.status(400).json({ error: "property, unit, and name query params are required" });
  }
  if (!memberCanAccessProperty(ctx, property)) {
    return res.status(403).json({ error: "No access to this property." });
  }
  const tenantCode = trimOrEmpty(req.query.tenantCode);
  try {
    const result = await query(
      `SELECT c.Id, c.PropertyName, c.Unit, c.TenantName, c.TenantCode,
              c.OpenYear, c.OpenMonth, c.InitialNote, c.FollowUpAt,
              c.IsClosed, c.ClosedAt, c.CreatedAt, c.CreatedByName,
              s.Status AS LatestStatus, s.ChangedAt AS LatestStatusAt,
              (SELECT COUNT(*) FROM dbo.UnitLegalCaseStatus WHERE CaseId = c.Id) AS StatusCount
       FROM dbo.UnitLegalCase c
       OUTER APPLY (
         SELECT TOP 1 Status, ChangedAt
         FROM dbo.UnitLegalCaseStatus
         WHERE CaseId = c.Id
         ORDER BY ChangedAt DESC, Id DESC
       ) s
       WHERE c.CompanyId = @companyId
         AND c.PropertyName = @property
         AND c.Unit = @unit
         AND c.TenantName = @name
         AND (
           (@tenantCode IS NULL AND (c.TenantCode IS NULL OR LTRIM(RTRIM(CAST(c.TenantCode AS NVARCHAR(200)))) = N''))
           OR (@tenantCode IS NOT NULL AND LTRIM(RTRIM(CAST(c.TenantCode AS NVARCHAR(200)))) = @tenantCode)
         )
       ORDER BY c.IsClosed ASC, c.CreatedAt DESC, c.Id DESC`,
      {
        companyId: { type: sql.Int, value: ctx.companyId },
        property: { type: sql.NVarChar(400), value: property },
        unit: { type: sql.NVarChar(400), value: unit },
        name: { type: sql.NVarChar(400), value: name },
        tenantCode: { type: sql.NVarChar(200), value: tenantCode === "" ? null : tenantCode }
      }
    );
    res.json({ cases: (result.recordset || []).map(rowCase) });
  } catch (e) {
    if (/Invalid object name/i.test(String(e?.message || ""))) {
      return res.json({ cases: [] });
    }
    throw e;
  }
}

async function createCase(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const b = req.body || {};
  const identity = validateRowIdentity(b, res);
  if (!identity) return;
  if (!memberCanAccessProperty(ctx, identity.property)) {
    return res.status(403).json({ error: "No access to this property." });
  }

  const openYear = Number(b.openYear);
  const openMonth = Number(b.openMonth);
  if (!Number.isInteger(openYear) || openYear < 1900 || openYear > 9999) {
    return res.status(400).json({ error: "openYear must be a valid year" });
  }
  if (!Number.isInteger(openMonth) || openMonth < 1 || openMonth > 12) {
    return res.status(400).json({ error: "openMonth must be 1..12" });
  }
  const initialNote = b.initialNote != null ? String(b.initialNote).slice(0, 4000) : null;
  const followUpAt = toIsoOrNull(b.followUpAt);
  const createdByName = b.createdByName != null ? String(b.createdByName).trim().slice(0, 256) : null;

  const result = await query(
    `INSERT INTO dbo.UnitLegalCase
       (CompanyId, PropertyName, Unit, TenantName, TenantCode, OpenYear, OpenMonth, InitialNote, FollowUpAt, CreatedByName)
     OUTPUT INSERTED.Id
     VALUES (@companyId, @property, @unit, @name, @tenantCode, @openYear, @openMonth, @initialNote, @followUpAt, @createdByName)`,
    {
      companyId: { type: sql.Int, value: ctx.companyId },
      property: { type: sql.NVarChar(400), value: identity.property },
      unit: { type: sql.NVarChar(400), value: identity.unit },
      name: { type: sql.NVarChar(400), value: identity.name },
      tenantCode: { type: sql.NVarChar(200), value: identity.tenantCode },
      openYear: { type: sql.SmallInt, value: openYear },
      openMonth: { type: sql.TinyInt, value: openMonth },
      initialNote: { type: sql.NVarChar(sql.MAX), value: initialNote },
      followUpAt: { type: sql.DateTime2, value: followUpAt ? new Date(followUpAt) : null },
      createdByName: { type: sql.NVarChar(256), value: createdByName }
    }
  );
  const id = result.recordset?.[0]?.Id;
  res.status(201).json({ id, caseId: id });
}

async function getCase(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid case id" });
  }
  const result = await query(
    `SELECT c.Id, c.PropertyName, c.Unit, c.TenantName, c.TenantCode,
            c.OpenYear, c.OpenMonth, c.InitialNote, c.FollowUpAt,
            c.IsClosed, c.ClosedAt, c.CreatedAt, c.CreatedByName,
            s.Status AS LatestStatus, s.ChangedAt AS LatestStatusAt,
            (SELECT COUNT(*) FROM dbo.UnitLegalCaseStatus WHERE CaseId = c.Id) AS StatusCount
     FROM dbo.UnitLegalCase c
     OUTER APPLY (
       SELECT TOP 1 Status, ChangedAt
       FROM dbo.UnitLegalCaseStatus
       WHERE CaseId = c.Id
       ORDER BY ChangedAt DESC, Id DESC
     ) s
     WHERE c.Id = @id AND c.CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  const row = result.recordset?.[0];
  if (!row) return res.status(404).json({ error: "not found" });
  if (!memberCanAccessProperty(ctx, row.PropertyName ?? "")) {
    return res.status(403).json({ error: "No access to this property." });
  }
  res.json({ case: rowCase(row) });
}

async function patchCase(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid case id" });
  }
  const existing = await query(
    `SELECT PropertyName FROM dbo.UnitLegalCase WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  const erow = existing.recordset?.[0];
  if (!erow) return res.status(404).json({ error: "not found" });
  if (!memberCanAccessProperty(ctx, erow.PropertyName ?? "")) {
    return res.status(403).json({ error: "No access to this property." });
  }

  const b = req.body || {};
  const fields = [];
  const inputs = {
    id: { type: sql.Int, value: id },
    companyId: { type: sql.Int, value: ctx.companyId }
  };
  if (b.followUpAt !== undefined) {
    const iso = toIsoOrNull(b.followUpAt);
    fields.push("FollowUpAt = @followUpAt");
    inputs.followUpAt = { type: sql.DateTime2, value: iso ? new Date(iso) : null };
  }
  if (b.initialNote !== undefined) {
    fields.push("InitialNote = @initialNote");
    inputs.initialNote = {
      type: sql.NVarChar(sql.MAX),
      value: b.initialNote == null ? null : String(b.initialNote).slice(0, 4000)
    };
  }
  if (b.openYear !== undefined) {
    const y = Number(b.openYear);
    if (!Number.isInteger(y) || y < 1900 || y > 9999) {
      return res.status(400).json({ error: "openYear invalid" });
    }
    fields.push("OpenYear = @openYear");
    inputs.openYear = { type: sql.SmallInt, value: y };
  }
  if (b.openMonth !== undefined) {
    const m = Number(b.openMonth);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: "openMonth invalid" });
    }
    fields.push("OpenMonth = @openMonth");
    inputs.openMonth = { type: sql.TinyInt, value: m };
  }
  if (b.isClosed !== undefined) {
    const closed = Boolean(b.isClosed);
    fields.push("IsClosed = @isClosed");
    fields.push("ClosedAt = CASE WHEN @isClosed = 1 THEN SYSUTCDATETIME() ELSE NULL END");
    inputs.isClosed = { type: sql.Bit, value: closed };
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  await query(
    `UPDATE dbo.UnitLegalCase SET ${fields.join(", ")} WHERE Id = @id AND CompanyId = @companyId`,
    inputs
  );
  res.status(204).end();
}

async function deleteCase(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid case id" });
  }
  const existing = await query(
    `SELECT PropertyName FROM dbo.UnitLegalCase WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  const erow = existing.recordset?.[0];
  if (!erow) return res.status(404).json({ error: "not found" });
  if (!memberCanAccessProperty(ctx, erow.PropertyName ?? "")) {
    return res.status(403).json({ error: "No access to this property." });
  }
  await query(
    `DELETE FROM dbo.UnitLegalCase WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  res.status(204).end();
}

async function listCaseStatuses(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid case id" });
  }
  const owner = await query(
    `SELECT PropertyName FROM dbo.UnitLegalCase WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  const ownerRow = owner.recordset?.[0];
  if (!ownerRow) return res.status(404).json({ error: "not found" });
  if (!memberCanAccessProperty(ctx, ownerRow.PropertyName ?? "")) {
    return res.status(403).json({ error: "No access to this property." });
  }
  const result = await query(
    `SELECT Id, CaseId, Status, Note, ChangedAt, CreatedByName
     FROM dbo.UnitLegalCaseStatus
     WHERE CaseId = @id
     ORDER BY ChangedAt DESC, Id DESC`,
    { id: { type: sql.Int, value: id } }
  );
  res.json({ statuses: (result.recordset || []).map(rowStatus) });
}

async function postCaseStatus(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid case id" });
  }
  const owner = await query(
    `SELECT PropertyName FROM dbo.UnitLegalCase WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  const ownerRow = owner.recordset?.[0];
  if (!ownerRow) return res.status(404).json({ error: "not found" });
  if (!memberCanAccessProperty(ctx, ownerRow.PropertyName ?? "")) {
    return res.status(403).json({ error: "No access to this property." });
  }
  const b = req.body || {};
  const status = b.status != null ? String(b.status).trim().slice(0, 200) : "";
  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }
  const note = b.note != null ? String(b.note).slice(0, 4000) : null;
  const createdByName = b.createdByName != null ? String(b.createdByName).trim().slice(0, 256) : null;
  const result = await query(
    `INSERT INTO dbo.UnitLegalCaseStatus (CaseId, Status, Note, CreatedByName)
     OUTPUT INSERTED.Id
     VALUES (@id, @status, @note, @createdByName)`,
    {
      id: { type: sql.Int, value: id },
      status: { type: sql.NVarChar(200), value: status },
      note: { type: sql.NVarChar(sql.MAX), value: note },
      createdByName: { type: sql.NVarChar(256), value: createdByName }
    }
  );
  res.status(201).json({ id: result.recordset?.[0]?.Id });
}

async function deleteCaseStatus(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const statusId = Number(req.params.statusId);
  if (!Number.isInteger(statusId) || statusId <= 0) {
    return res.status(400).json({ error: "Invalid status id" });
  }
  const owner = await query(
    `SELECT c.PropertyName, s.Id
     FROM dbo.UnitLegalCaseStatus s
     INNER JOIN dbo.UnitLegalCase c ON c.Id = s.CaseId
     WHERE s.Id = @statusId AND c.CompanyId = @companyId`,
    {
      statusId: { type: sql.Int, value: statusId },
      companyId: { type: sql.Int, value: ctx.companyId }
    }
  );
  const ownerRow = owner.recordset?.[0];
  if (!ownerRow) return res.status(404).json({ error: "not found" });
  if (!memberCanAccessProperty(ctx, ownerRow.PropertyName ?? "")) {
    return res.status(403).json({ error: "No access to this property." });
  }
  await query(`DELETE FROM dbo.UnitLegalCaseStatus WHERE Id = @statusId`, {
    statusId: { type: sql.Int, value: statusId }
  });
  res.status(204).end();
}

/** Public-ish endpoint (any signed-in user with property access) — returns the legal status options
 *  from the preset list selected on the property. */
async function getPropertyLegalStatusOptions(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const property = trimOrEmpty(req.query.property);
  if (!property) {
    return res.status(400).json({ error: "property query param is required" });
  }
  if (!memberCanAccessProperty(ctx, property)) {
    return res.status(403).json({ error: "No access to this property." });
  }
  try {
    const listName = await findLegalStatusListNameForProperty(ctx.companyId, property);
    if (!listName) {
      return res.json({ listName: "", options: [] });
    }
    const result = await query(
      `SELECT o.Id, o.Status, o.SortOrder
       FROM dbo.LegalStatusPresetList l
       INNER JOIN dbo.LegalStatusPresetOption o ON o.ListId = l.Id
       WHERE l.Name = @listName
       ORDER BY o.SortOrder ASC, o.Status ASC`,
      {
        listName: { type: sql.NVarChar(100), value: listName }
      }
    );
    res.json({
      listName,
      options: (result.recordset || []).map((r) => ({
        id: Number(r.Id ?? r.id),
        status: String(r.Status ?? r.status ?? "").trim(),
        sortOrder: r.SortOrder != null ? Number(r.SortOrder) : 0
      }))
    });
  } catch (e) {
    if (/Invalid object name/i.test(String(e?.message || ""))) {
      return res.json({ options: [] });
    }
    throw e;
  }
}

module.exports = {
  listCases,
  createCase,
  getCase,
  patchCase,
  deleteCase,
  listCaseStatuses,
  postCaseStatus,
  deleteCaseStatus,
  getPropertyLegalStatusOptions
};
