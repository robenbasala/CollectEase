"use strict";

const { getPool } = require("../../db");
const { getDboTableSchema } = require("../sqlSchemaService");
const { autoMapColumns } = require("../columnNormalize");
const { applyTransforms, typeCompatibilityWarning } = require("./etlValueTransform");
const { iterateRecords } = require("./dataverseApi");
const { credsFromRow } = require("./etlRepo");
const etlRepo = require("./etlRepo");
const { upsertDataTblRow, deleteCompanyRows } = require("./etlUpsert");

const MAX_DETAIL_ERRORS = 500;
/** Push Running progress to DB often enough for live UI (not only per Dataverse page). */
const PROGRESS_UPDATE_EVERY = 50;

function parseJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function buildDestRow(sourceRecord, mappingConfig, schema, companyId) {
  const byDest = new Map(schema.map((c) => [c.column, c]));
  const dest = {};
  const defaults = mappingConfig.defaultValues || {};

  for (const [col, val] of Object.entries(defaults)) {
    if (byDest.has(col)) dest[col] = val;
  }

  if (companyId != null && byDest.has("CompanyId")) {
    dest.CompanyId = companyId;
  }

  for (const m of mappingConfig.columnMappings || []) {
    const destCol = String(m.destinationColumn || "").trim();
    if (!destCol || !byDest.has(destCol)) continue;
    const meta = byDest.get(destCol);
    let raw = m.sourceColumn ? sourceRecord[m.sourceColumn] : undefined;
    if ((raw === undefined || raw === null || raw === "") && m.defaultValue !== undefined) {
      raw = m.defaultValue;
    }
    const { value } = applyTransforms(raw, m.transforms || [], meta);
    dest[destCol] = value;
  }

  const now = new Date();
  if (byDest.has("UpdatedAt")) dest.UpdatedAt = now;
  if (byDest.has("CreatedAt") && !dest.CreatedAt) dest.CreatedAt = now;

  return dest;
}

function autoMapPayload(sourceColumns, destSchema) {
  const source = sourceColumns.map((c) => ({ name: c.logicalName, dataType: c.dataType }));
  const dest = destSchema.map((c) => ({ column: c.column, dataType: c.dataType }));
  const pairs = autoMapColumns(source, dest);
  return {
    columnMappings: pairs.map((p) => ({
      sourceColumn: p.sourceColumn,
      destinationColumn: p.destinationColumn,
      transforms: ["trim", "cleanInvalidChars"],
      defaultValue: null,
      confidence: p.confidence,
      matchType: p.matchType
    })),
    defaultValues: {}
  };
}

function mappingWarnings(mappingConfig, sourceColumns, destSchema) {
  const warnings = [];
  const srcMap = new Map(sourceColumns.map((c) => [c.logicalName, c]));
  const destMap = new Map(destSchema.map((c) => [c.column, c]));
  for (const m of mappingConfig.columnMappings || []) {
    if (!m.sourceColumn || !m.destinationColumn) continue;
    const s = srcMap.get(m.sourceColumn);
    const d = destMap.get(m.destinationColumn);
    if (s && d) {
      const w = typeCompatibilityWarning(s.dataType, d.dataType);
      if (w) warnings.push({ source: m.sourceColumn, destination: m.destinationColumn, message: w });
    }
  }
  return warnings;
}

/**
 * Run import in background; updates EtlImportLogs as it progresses.
 */
async function runImportAsync(logId, opts) {
  const {
    connectionRow,
    mappingRow,
    companyId,
    createdBy,
    importModeOverride
  } = opts;

  const creds = credsFromRow(connectionRow);
  const mappingConfig = parseJson(mappingRow.MappingJson, { columnMappings: [], defaultValues: {} });
  const uniqueKeys = parseJson(mappingRow.UniqueKeyJson, []);
  const importMode = importModeOverride || mappingRow.ImportMode || "upsert";
  const destTable = String(mappingRow.DestinationTable || "DataTbl").replace(/^dbo\./i, "");
  const batchSize = Number(mappingRow.BatchSize) || 500;

  let schema;
  try {
    schema = await getDboTableSchema(destTable);
  } catch (e) {
    await etlRepo.updateImportLog(logId, {
      status: "Failed",
      finishedAt: new Date(),
      errorSummary: e.message
    });
    return;
  }

  const stats = { read: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const errorSamples = [];

  try {
    const pool = await getPool();

    if (importMode === "delete_reload" && companyId != null) {
      await deleteCompanyRows(pool, destTable, companyId);
    }

    let rowNum = 0;
    for await (const { record, sourceId } of iterateRecords(
      creds,
      mappingRow.SourceTableLogicalName,
      mappingRow.SourceEntitySetName,
      batchSize,
      { companyId, mappingConfig }
    )) {
      stats.read += 1;
      rowNum += 1;
      try {
        const destValues = buildDestRow(record, mappingConfig, schema, companyId);
        const mode = importMode === "insert_only" ? "insert_only" : "upsert";
        const result = await upsertDataTblRow(
          pool,
          destTable,
          schema,
          mode,
          uniqueKeys,
          destValues,
          companyId
        );
        if (result === "inserted") stats.inserted += 1;
        else if (result === "updated") stats.updated += 1;
        else stats.skipped += 1;

        if (rowNum === 1 || rowNum % PROGRESS_UPDATE_EVERY === 0) {
          await etlRepo.updateImportLog(logId, {
            totalRead: stats.read,
            totalInserted: stats.inserted,
            totalUpdated: stats.updated,
            totalSkipped: stats.skipped,
            totalErrors: stats.errors
          });
        }
      } catch (rowErr) {
        stats.errors += 1;
        if (errorSamples.length < MAX_DETAIL_ERRORS) {
          errorSamples.push(rowErr.message);
          await etlRepo.addLogDetail({
            importLogId: logId,
            rowNumber: rowNum,
            sourceRecordId: sourceId ? String(sourceId) : null,
            status: "Error",
            errorMessage: rowErr.message,
            sourceJson: JSON.stringify(record).slice(0, 8000)
          });
        }
      }
    }

    const status = stats.errors > 0 ? "CompletedWithErrors" : "Completed";
    await etlRepo.updateImportLog(logId, {
      status,
      finishedAt: new Date(),
      totalRead: stats.read,
      totalInserted: stats.inserted,
      totalUpdated: stats.updated,
      totalSkipped: stats.skipped,
      totalErrors: stats.errors,
      errorSummary: errorSamples.length ? errorSamples.slice(0, 20).join("\n") : null
    });
    if (mappingRow.Id) {
      await etlRepo.touchMappingLastRun(mappingRow.Id, { lastRunStatus: status }).catch(() => {});
    }
  } catch (fatal) {
    await etlRepo.updateImportLog(logId, {
      status: "Failed",
      finishedAt: new Date(),
      totalRead: stats.read,
      totalInserted: stats.inserted,
      totalUpdated: stats.updated,
      totalSkipped: stats.skipped,
      totalErrors: stats.errors,
      errorSummary: fatal.message
    });
    if (mappingRow.Id) {
      await etlRepo.touchMappingLastRun(mappingRow.Id, { lastRunStatus: "Failed" }).catch(() => {});
    }
  }
}

/**
 * Start import for a saved mapping (manual or scheduled).
 * @returns {Promise<number>} logId
 */
async function runMappingImport(companyId, mappingId, options = {}) {
  const mappingRow = await etlRepo.getMappingById(mappingId);
  if (!mappingRow) {
    const e = new Error("Mapping not found");
    e.status = 404;
    throw e;
  }
  if (!etlRepo.mappingBelongsToCompany(mappingRow, companyId)) {
    const e = new Error("Mapping not found for this company");
    e.status = 404;
    throw e;
  }
  const connectionRow = await etlRepo.getConnectionById(mappingRow.ConnectionId);
  if (!connectionRow) {
    const e = new Error("Connection not found");
    e.status = 404;
    throw e;
  }

  const logId = await etlRepo.createImportLog({
    mappingId: mappingRow.Id,
    connectionId: connectionRow.Id,
    sourceTableLogicalName: mappingRow.SourceTableLogicalName,
    destinationTable: mappingRow.DestinationTable || "DataTbl",
    status: "Running",
    createdBy: options.createdBy ?? null,
    companyId,
    triggerType: options.triggerType || "manual"
  });

  startImport(logId, {
    connectionRow,
    mappingRow,
    companyId,
    createdBy: options.createdBy,
    importModeOverride: options.importMode
  });

  return logId;
}

function startImport(logId, opts) {
  setImmediate(() => {
    runImportAsync(logId, opts).catch((e) => {
      console.error("[etl-import]", e);
    });
  });
}

module.exports = {
  autoMapPayload,
  mappingWarnings,
  buildDestRow,
  runImportAsync,
  startImport,
  runMappingImport
};
