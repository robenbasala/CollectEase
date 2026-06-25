"use strict";

const { readCompanyContext } = require("../helpers/companyContext");
const { getDboTableSchema } = require("../services/sqlSchemaService");
const { autoMapColumns } = require("../services/columnNormalize");
const dataverseApi = require("../services/etl/dataverseApi");
const etlRepo = require("../services/etl/etlRepo");
const etlImportEngine = require("../services/etl/etlImportEngine");
const {
  mergeCredsWithEnv,
  getDataverseConnectionDefaults
} = require("../config/dataverseEnv");

function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function ctxOrFail(req, res) {
  const ctx = readCompanyContext(req, res);
  return ctx || null;
}

function credsFromBody(body) {
  return mergeCredsWithEnv(body || {});
}

async function resolveCreds(req, connectionId, body) {
  if (connectionId) {
    const row = await etlRepo.getConnectionById(connectionId);
    if (!row) {
      const e = new Error("Connection not found");
      e.status = 404;
      throw e;
    }
    return { creds: etlRepo.credsFromRow(row), row };
  }
  const creds = credsFromBody(body);
  if (creds.clientSecret) return { creds, row: null };
  const e = new Error(
    "connectionId, clientSecret in request, or DATAVERSE_CLIENT_SECRET in server .env required"
  );
  e.status = 400;
  throw e;
}

async function getConnectionDefaults(req, res) {
  if (!ctxOrFail(req, res)) return;
  res.json(getDataverseConnectionDefaults());
}

// --- Connections ---

async function testConnection(req, res) {
  if (!ctxOrFail(req, res)) return;
  const body = req.body || {};
  const creds = body.connectionId
    ? (await resolveCreds(req, Number(body.connectionId), body)).creds
    : credsFromBody(body);
  const result = await dataverseApi.testConnection(creds);
  res.json(result);
}

async function listConnections(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const rows = await etlRepo.listConnections(ctx.companyId);
  res.json({ connections: rows });
}

async function createConnection(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const body = req.body || {};
  const creds = credsFromBody(body);
  if (!creds.clientSecret) {
    return res.status(400).json({
      error: "clientSecret is required when creating a connection (form or DATAVERSE_CLIENT_SECRET in .env)"
    });
  }
  await dataverseApi.testConnection(creds);
  const id = await etlRepo.createConnection(
    {
      name: body.name,
      environmentUrl: creds.environmentUrl,
      tenantId: creds.tenantId,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret
    },
    ctx.companyId
  );
  res.status(201).json({ id });
}

async function updateConnection(req, res) {
  if (!ctxOrFail(req, res)) return;
  const id = Number(req.params.id);
  const body = req.body || {};
  if (body.clientSecret) {
    const row = await etlRepo.getConnectionById(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const creds = { ...etlRepo.credsFromRow(row), ...credsFromBody(body), clientSecret: body.clientSecret };
    await dataverseApi.testConnection(creds);
  }
  await etlRepo.updateConnection(id, body);
  res.json({ ok: true });
}

async function deleteConnection(req, res) {
  if (!ctxOrFail(req, res)) return;
  await etlRepo.deleteConnection(Number(req.params.id));
  res.json({ ok: true });
}

// --- Dataverse metadata ---

async function listTables(req, res) {
  if (!ctxOrFail(req, res)) return;
  const { creds } = await resolveCreds(req, Number(req.params.id), req.body || {});
  const tables = await dataverseApi.listTables(creds);
  res.json({ tables });
}

async function getTableColumns(req, res) {
  if (!ctxOrFail(req, res)) return;
  const { creds } = await resolveCreds(req, Number(req.params.id), {});
  const logicalName = req.params.tableLogicalName;
  const columns = await dataverseApi.getTableColumns(creds, logicalName);
  res.json({ columns });
}

async function previewTable(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const { creds } = await resolveCreds(req, Number(req.params.id), {});
  const top = Math.min(Number(req.query.top) || 50, 200);
  const entitySet = req.query.entitySet || null;
  const nextLink = req.query.nextLink ? String(req.query.nextLink) : "";
  const afterId = req.query.afterId ? String(req.query.afterId) : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const mappingConfig = buildPreviewMappingConfig(req.query);
  const data = await dataverseApi.previewRecords(creds, req.params.tableLogicalName, entitySet, {
    top,
    nextLink: nextLink || undefined,
    afterId: afterId || undefined,
    page,
    companyId: ctx.companyId,
    mappingConfig
  });
  res.json(data);
}

function buildPreviewMappingConfig(query = {}) {
  const cfg = {};
  const rawEnabled = query.sourceCompanyFilterEnabled;
  if (rawEnabled === "0" || rawEnabled === "false") {
    cfg.enabled = false;
    return { sourceCompanyFilter: cfg };
  }
  const rawValue = query.sourceCompanyValue;
  if (rawValue != null && String(rawValue).trim() !== "") {
    const n = Number(rawValue);
    if (Number.isFinite(n)) {
      cfg.enabled = true;
      cfg.sourceValue = Math.trunc(n);
      cfg.useWorkspaceId = false;
      return { sourceCompanyFilter: cfg };
    }
  }
  return {};
}

// --- SQL destination ---

async function getDataTblColumns(req, res) {
  if (!ctxOrFail(req, res)) return;
  const schema = await getDboTableSchema("DataTbl");
  res.json({ table: "dbo.DataTbl", columns: schema });
}

// --- Mappings ---

async function listMappings(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const rows = await etlRepo.listMappings(ctx.companyId);
  res.json({
    mappings: rows.map((m) => ({
      id: m.Id,
      name: m.Name,
      connectionId: m.ConnectionId,
      connectionName: m.ConnectionName,
      sourceTableLogicalName: m.SourceTableLogicalName,
      sourceEntitySetName: m.SourceEntitySetName,
      destinationTable: m.DestinationTable,
      importMode: m.ImportMode,
      companyId: m.CompanyId,
      scheduleType: m.ScheduleType || "manual",
      scheduleValue: m.ScheduleValue,
      isEnabled: m.IsEnabled === true || m.IsEnabled === 1,
      lastRunAt: m.LastRunAt,
      lastRunStatus: m.LastRunStatus,
      updatedAt: m.UpdatedAt
    }))
  });
}

async function getMapping(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const m = await etlRepo.getMappingById(Number(req.params.id));
  if (!m || !etlRepo.mappingBelongsToCompany(m, ctx.companyId)) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({
    id: m.Id,
    name: m.Name,
    connectionId: m.ConnectionId,
    sourceTableLogicalName: m.SourceTableLogicalName,
    sourceEntitySetName: m.SourceEntitySetName,
    destinationTable: m.DestinationTable,
    uniqueKey: JSON.parse(m.UniqueKeyJson || "[]"),
    mapping: JSON.parse(m.MappingJson || "{}"),
    importMode: m.ImportMode,
    batchSize: m.BatchSize,
    companyId: m.CompanyId,
    scheduleType: m.ScheduleType || "manual",
    scheduleValue: m.ScheduleValue,
    isEnabled: m.IsEnabled === true || m.IsEnabled === 1,
    lastRunAt: m.LastRunAt,
    lastRunStatus: m.LastRunStatus
  });
}

async function createMapping(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const body = req.body || {};
  const id = await etlRepo.createMapping({
    name: body.name,
    connectionId: body.connectionId,
    sourceTableLogicalName: body.sourceTableLogicalName,
    sourceEntitySetName: body.sourceEntitySetName,
    destinationTable: body.destinationTable || "DataTbl",
    uniqueKeyJson: JSON.stringify(body.uniqueKey || []),
    mappingJson: JSON.stringify(body.mapping || {}),
    importMode: body.importMode || "upsert",
    companyId: ctx.companyId,
    batchSize: body.batchSize || 500,
    scheduleType: body.scheduleType || "manual",
    scheduleValue: body.scheduleValue ?? null,
    isEnabled: body.isEnabled !== false
  });
  res.status(201).json({ id });
}

async function updateMapping(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  const existing = await etlRepo.getMappingById(id);
  if (!existing || !etlRepo.mappingBelongsToCompany(existing, ctx.companyId)) {
    return res.status(404).json({ error: "Not found" });
  }
  const body = req.body || {};
  const patch = { ...body };
  if (body.uniqueKey) patch.uniqueKeyJson = JSON.stringify(body.uniqueKey);
  if (body.mapping) patch.mappingJson = JSON.stringify(body.mapping);
  if (body.isEnabled !== undefined) patch.isEnabled = body.isEnabled ? 1 : 0;
  delete patch.uniqueKey;
  delete patch.mapping;
  await etlRepo.updateMapping(id, patch);
  res.json({ ok: true });
}

async function deleteMapping(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  const m = await etlRepo.getMappingById(id);
  if (!m || !etlRepo.mappingBelongsToCompany(m, ctx.companyId)) {
    return res.status(404).json({ error: "Not found" });
  }
  await etlRepo.deleteMapping(id);
  res.json({ ok: true });
}

async function listMappingImportLogs(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  const m = await etlRepo.getMappingById(id);
  if (!m || !etlRepo.mappingBelongsToCompany(m, ctx.companyId)) {
    return res.status(404).json({ error: "Not found" });
  }
  const logs = await etlRepo.listImportLogsByMapping(ctx.companyId, id);
  res.json({ logs });
}

async function autoMap(req, res) {
  if (!ctxOrFail(req, res)) return;
  const body = req.body || {};
  const sourceColumns = body.sourceColumns || [];
  const destSchema = await getDboTableSchema("DataTbl");
  const mapping = etlImportEngine.autoMapPayload(sourceColumns, destSchema);
  const warnings = etlImportEngine.mappingWarnings(mapping, sourceColumns, destSchema);
  res.json({ mapping, warnings, destinationColumns: destSchema });
}

// --- Import ---

async function importPreview(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const body = req.body || {};
  const { creds } = await resolveCreds(req, body.connectionId, body);
  const top = Math.min(Number(body.top) || 10, 50);
  const mappingBody = body.mapping || null;
  const preview = await dataverseApi.previewRecords(
    creds,
    body.sourceTableLogicalName,
    body.sourceEntitySetName,
    { top, companyId: ctx.companyId, mappingConfig: mappingBody }
  );
  const destSchema = await getDboTableSchema("DataTbl");
  const mapping =
    mappingBody ||
    etlImportEngine.autoMapPayload(
      (body.sourceColumns || []).length
        ? body.sourceColumns
        : preview.columns.map((c) => ({ logicalName: c, dataType: "string" })),
      destSchema
    );
  const mappedRows = preview.rows.map((row) =>
    etlImportEngine.buildDestRow(row, mapping, destSchema, ctx.companyId)
  );
  res.json({ preview, mappedRows, mapping });
}

async function runImport(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const body = req.body || {};
  const mappingId = body.mappingId ? Number(body.mappingId) : null;

  if (mappingId) {
    const logId = await etlImportEngine.runMappingImport(ctx.companyId, mappingId, {
      triggerType: "manual",
      createdBy: req.ct?.email || req.firebase?.email || null,
      importMode: body.importMode
    });
    return res.status(202).json({ logId, status: "Running" });
  }

  const connectionRow = await etlRepo.getConnectionById(Number(body.connectionId));
  if (!connectionRow) return res.status(404).json({ error: "Connection not found" });
  const mappingRow = {
    SourceTableLogicalName: body.sourceTableLogicalName,
    SourceEntitySetName: body.sourceEntitySetName,
    DestinationTable: "DataTbl",
    UniqueKeyJson: JSON.stringify(body.uniqueKey || []),
    MappingJson: JSON.stringify(body.mapping || {}),
    ImportMode: body.importMode || "upsert",
    BatchSize: body.batchSize || 500
  };

  const logId = await etlRepo.createImportLog({
    mappingId: null,
    connectionId: connectionRow.Id,
    sourceTableLogicalName: mappingRow.SourceTableLogicalName,
    destinationTable: mappingRow.DestinationTable || "DataTbl",
    status: "Running",
    createdBy: req.ct?.email || req.firebase?.email || null,
    companyId: ctx.companyId,
    triggerType: "manual"
  });

  etlImportEngine.startImport(logId, {
    connectionRow,
    mappingRow,
    companyId: ctx.companyId,
    createdBy: req.ct?.email,
    importModeOverride: body.importMode
  });

  res.status(202).json({ logId, status: "Running" });
}

async function listImportLogs(req, res) {
  const ctx = ctxOrFail(req, res);
  if (!ctx) return;
  const logs = await etlRepo.listImportLogs(ctx.companyId);
  res.json({ logs });
}

async function getImportLog(req, res) {
  if (!ctxOrFail(req, res)) return;
  const log = await etlRepo.getImportLog(Number(req.params.id));
  if (!log) return res.status(404).json({ error: "Not found" });
  const details = await etlRepo.listImportLogDetails(log.Id, 100);
  res.json({ log, details });
}

module.exports = {
  getConnectionDefaults,
  testConnection,
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  listTables,
  getTableColumns,
  previewTable,
  getDataTblColumns,
  listMappings,
  getMapping,
  createMapping,
  updateMapping,
  deleteMapping,
  listMappingImportLogs,
  autoMap,
  importPreview,
  runImport,
  listImportLogs,
  getImportLog
};
