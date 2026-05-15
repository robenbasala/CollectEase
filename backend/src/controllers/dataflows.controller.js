"use strict";

const { readCompanyContext } = require("../helpers/companyContext");
const { requireCompanyScope } = require("../helpers/dataflowAccess");
const repo = require("../services/dataflowsRepo");
const { readExcelWorkbookPreview } = require("../services/excelSourceReader");
const { previewTransformation, executeDataflowRun } = require("../services/dataflowRunExecutor");
const { autoMapColumns } = require("../services/columnNormalize");
const { listDboTables, getDboTableSchema, assertSafeIdent } = require("../services/sqlSchemaService");

function mapDataflow(r) {
  if (!r) return null;
  return {
    id: r.Id,
    companyId: r.CompanyId,
    name: r.Name,
    description: r.Description,
    sourceType: r.SourceType,
    sourcePath: r.SourcePath,
    sheetName: r.SheetName,
    excelTableName: r.ExcelTableName,
    transformationScript: r.TransformationScript,
    destinationTable: r.DestinationTable,
    uniqueKeyColumn: r.UniqueKeyColumn,
    upsertMode: r.UpsertMode,
    scheduleType: r.ScheduleType,
    scheduleValue: r.ScheduleValue,
    isEnabled: r.IsEnabled === true || r.IsEnabled === 1,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
    lastRunAt: r.LastRunAt,
    lastRunStatus: r.LastRunStatus,
    lastRunMessage: r.LastRunMessage
  };
}

function mapMapping(r) {
  if (!r) return null;
  return {
    id: r.Id,
    dataflowId: r.DataflowId,
    sourceColumn: r.SourceColumn,
    destinationColumn: r.DestinationColumn,
    destinationDataType: r.DestinationDataType,
    isRequired: r.IsRequired === true || r.IsRequired === 1,
    isMapped: r.IsMapped !== false && r.IsMapped !== 0,
    defaultValue: r.DefaultValue,
    expression: r.Expression,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt
  };
}

function mapRun(r) {
  if (!r) return null;
  return {
    id: r.Id,
    dataflowId: r.DataflowId,
    companyId: r.CompanyId,
    startedAt: r.StartedAt,
    finishedAt: r.FinishedAt,
    status: r.Status,
    totalRows: r.TotalRows,
    insertedRows: r.InsertedRows,
    updatedRows: r.UpdatedRows,
    skippedRows: r.SkippedRows,
    failedRows: r.FailedRows,
    errorMessage: r.ErrorMessage,
    logJson: r.LogJson
  };
}

async function listByCompany(req, res) {
  const cid = requireCompanyScope(req, res, req.params.companyId);
  if (!cid) return;
  const rows = await repo.listDataflows(cid);
  res.json({ dataflows: rows.map(mapDataflow) });
}

async function getOne(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const row = await repo.getDataflowById(id, ctx.companyId);
  if (!row) return res.status(404).json({ error: "Not found" });
  const mappings = await repo.listMappings(id);
  res.json({ dataflow: mapDataflow(row), mappings: mappings.map(mapMapping) });
}

async function createOne(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const cid = requireCompanyScope(req, res, req.params.companyId);
  if (!cid) return;
  const body = req.body || {};
  if (!String(body.name || "").trim()) return res.status(400).json({ error: "name is required" });
  if (!String(body.destinationTable || "").trim()) return res.status(400).json({ error: "destinationTable is required" });
  if (!String(body.uniqueKeyColumn || "").trim()) return res.status(400).json({ error: "uniqueKeyColumn is required" });
  try {
    assertSafeIdent(body.destinationTable, "table");
    assertSafeIdent(body.uniqueKeyColumn, "column");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const inserted = await repo.insertDataflow(cid, body);
  const id = inserted.Id;
  if (Array.isArray(body.mappings)) {
    await repo.replaceMappings(
      id,
      body.mappings.map((m) => ({
        sourceColumn: m.sourceColumn,
        destinationColumn: m.destinationColumn,
        destinationDataType: m.destinationDataType,
        isRequired: !!m.isRequired,
        isMapped: m.isMapped !== false,
        defaultValue: m.defaultValue,
        expression: m.expression
      }))
    );
  }
  const fresh = await repo.getDataflowById(id, cid);
  const mappings = await repo.listMappings(id);
  res.status(201).json({ dataflow: mapDataflow(fresh), mappings: mappings.map(mapMapping) });
}

async function updateOne(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const existing = await repo.getDataflowById(id, ctx.companyId);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  try {
    if (body.destinationTable) assertSafeIdent(body.destinationTable, "table");
    if (body.uniqueKeyColumn) assertSafeIdent(body.uniqueKeyColumn, "column");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await repo.updateDataflow(id, ctx.companyId, body);
  if (Array.isArray(body.mappings)) {
    await repo.replaceMappings(
      id,
      body.mappings.map((m) => ({
        sourceColumn: m.sourceColumn,
        destinationColumn: m.destinationColumn,
        destinationDataType: m.destinationDataType,
        isRequired: !!m.isRequired,
        isMapped: m.isMapped !== false,
        defaultValue: m.defaultValue,
        expression: m.expression
      }))
    );
  }
  const fresh = await repo.getDataflowById(id, ctx.companyId);
  const mappings = await repo.listMappings(id);
  res.json({ dataflow: mapDataflow(fresh), mappings: mappings.map(mapMapping) });
}

async function deleteOne(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const existing = await repo.getDataflowById(id, ctx.companyId);
  if (!existing) return res.status(404).json({ error: "Not found" });
  await repo.deleteDataflow(id, ctx.companyId);
  res.status(204).end();
}

async function postReadSource(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const b = req.body || {};
  const cid = Number(b.companyId);
  if (cid !== ctx.companyId) return res.status(403).json({ error: "companyId mismatch" });
  try {
    const meta = await readExcelWorkbookPreview(b.sourceType, b.sourcePath, Number(b.maxRowsPerSheet) || undefined);
    res.json(meta);
  } catch (e) {
    const code = e.code || "READ_ERROR";
    res.status(400).json({ error: e.message || "read failed", code });
  }
}

async function postPreview(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const b = req.body || {};
  const cid = Number(b.companyId);
  if (cid !== ctx.companyId) return res.status(403).json({ error: "companyId mismatch" });
  try {
    const out = await previewTransformation({
      sourceType: b.sourceType,
      sourcePath: b.sourcePath,
      transformationScript: b.transformationScript,
      maxRows: Math.min(20000, Number(b.maxRows) || 4000)
    });
    if (!out.ok)
      return res.status(400).json({
        error: out.error,
        code: "PIPELINE",
        validationErrors: out.validationErrors || [],
        warnings: out.warnings || [],
        sheetNames: out.sheetNames,
        tableNames: out.tableNames
      });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message || "preview failed", code: e.code || "PREVIEW" });
  }
}

async function postAutoMap(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const b = req.body || {};
  const cid = Number(b.companyId);
  if (cid !== ctx.companyId) return res.status(403).json({ error: "companyId mismatch" });
  try {
    const destTable = assertSafeIdent(b.destinationTable, "table");
    const schema = await getDboTableSchema(destTable);
    const destCols = schema
      .filter((c) => !c.isIdentity && !c.isComputed)
      .map((c) => ({ column: c.column, dataType: c.dataType }));
    const sourceCols = (b.sourceColumns || []).map((x) => ({
      name: typeof x === "string" ? x : x.name,
      dataType: x.dataType
    }));
    const suggestions = autoMapColumns(sourceCols, destCols);
    res.json({ suggestions, destinationColumns: destCols });
  } catch (e) {
    res.status(400).json({ error: e.message || "auto-map failed", code: e.code || "AUTOMAP" });
  }
}

async function postRun(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const summary = await executeDataflowRun(ctx.companyId, id);
    res.json({ summary });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message || "Run failed" });
  }
}

async function listRuns(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const df = await repo.getDataflowById(id, ctx.companyId);
  if (!df) return res.status(404).json({ error: "Not found" });
  const limit = Number(req.query.limit) || 50;
  const rows = await repo.listRuns(id, ctx.companyId, limit);
  res.json({ runs: rows.map(mapRun) });
}

async function getRun(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const runId = Number(req.params.runId);
  if (!Number.isInteger(runId) || runId <= 0) return res.status(400).json({ error: "Invalid run id" });
  const row = await repo.getRun(runId, ctx.companyId);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ run: mapRun(row) });
}

async function getRunErrors(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  const runId = Number(req.params.runId);
  if (!Number.isInteger(runId) || runId <= 0) return res.status(400).json({ error: "Invalid run id" });
  const list = await repo.listRunErrors(runId, ctx.companyId, Number(req.query.limit) || 500);
  if (list == null) return res.status(404).json({ error: "Not found" });
  res.json({
    errors: list.map((e) => ({
      id: e.Id,
      runId: e.RunId,
      rowNumber: e.RowNumber,
      uniqueKeyValue: e.UniqueKeyValue,
      errorMessage: e.ErrorMessage,
      rawRowJson: e.RawRowJson
    }))
  });
}

async function getSqlTables(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  try {
    const tables = await listDboTables();
    res.json({ tables });
  } catch (e) {
    res.status(500).json({ error: e.message || "list tables failed" });
  }
}

async function getSqlTableSchema(req, res) {
  const ctx = readCompanyContext(req, res);
  if (!ctx) return;
  try {
    const tableName = assertSafeIdent(req.params.tableName, "table");
    const schema = await getDboTableSchema(tableName);
    res.json({ table: tableName, columns: schema });
  } catch (e) {
    res.status(400).json({ error: e.message || "schema failed", code: e.code });
  }
}

module.exports = {
  listByCompany,
  getOne,
  createOne,
  updateOne,
  deleteOne,
  postReadSource,
  postPreview,
  postAutoMap,
  postRun,
  listRuns,
  getRun,
  getRunErrors,
  getSqlTables,
  getSqlTableSchema
};
