"use strict";

const { readExcelWorkbookPreview } = require("./excelSourceReader");
const { runTransformationEngine } = require("./transformationEngine");
const { getDboTableSchema, assertSafeIdent, validateColumnsAgainstSchema } = require("./sqlSchemaService");
const { upsertRow, coerceValue } = require("./dataflowUpsertService");
const { getPool } = require("../db");
const repo = require("./dataflowsRepo");

const MAX_ROWS_DEFAULT = Number(process.env.DATAFLOW_MAX_ROWS || 25000);

/**
 * Build engine sheet map: { SheetName: { rows } }
 * @param {Record<string, { columns: string[], rows: Record<string, unknown>[], rowCount: number }>} sheets
 */
function sheetsForEngine(sheets) {
  /** @type {Record<string, { rows: Record<string, unknown>[] }>} */
  const out = {};
  for (const [name, pack] of Object.entries(sheets || {})) {
    out[name] = { rows: Array.isArray(pack.rows) ? pack.rows : [] };
  }
  return out;
}

/**
 * @param {object} opts
 */
async function previewTransformation(opts) {
  const { sourceType, sourcePath, transformationScript, maxRows = 200 } = opts;
  const perSheet = Math.min(20000, Math.max(50, Number(maxRows) || 2000));
  const meta = await readExcelWorkbookPreview(sourceType, sourcePath, perSheet);
  const sheets = sheetsForEngine(meta.sheets);
  const initialRows = meta.sheets[meta.defaultSheet]?.rows || [];
  const eng = runTransformationEngine(transformationScript || "", initialRows, {
    sheets,
    sheetNames: meta.sheetNames || []
  });
  if (!eng.ok) {
    return {
      ok: false,
      error: eng.error,
      validationErrors: eng.validationErrors || [],
      warnings: eng.warnings || [],
      columns: [],
      rows: [],
      rowCount: 0,
      sheetNames: meta.sheetNames,
      defaultSheet: meta.defaultSheet,
      defaultPreview: meta.defaultPreview,
      sheetsAvailable: meta.sheetNames
    };
  }
  return {
    ok: true,
    error: null,
    validationErrors: [],
    warnings: eng.warnings || [],
    columns: eng.columns,
    rows: eng.rows.slice(0, perSheet),
    rowCount: eng.rows.length,
    sheetNames: meta.sheetNames,
    defaultSheet: meta.defaultSheet,
    defaultPreview: meta.defaultPreview,
    sheetsAvailable: meta.sheetNames
  };
}

/**
 * @param {object} dfRow from dbo.CompanyDataflow
 * @param {object[]} mappingRows
 */
function validateBeforeRun(dfRow, mappingRows) {
  const table = assertSafeIdent(dfRow.DestinationTable, "table");
  const uk = assertSafeIdent(dfRow.UniqueKeyColumn, "column");
  const mode = String(dfRow.UpsertMode || "").toLowerCase();
  if (!["insert_only", "update_only", "insert_update"].includes(mode)) {
    const e = new Error("Invalid upsert mode");
    e.statusCode = 400;
    throw e;
  }
  const activeMaps = (mappingRows || []).filter((m) => m.IsMapped !== false && m.IsMapped !== 0);
  const destCols = new Set(activeMaps.map((m) => String(m.DestinationColumn || "").trim()));
  if (!destCols.has(uk)) {
    const e = new Error(`Unique key column "${uk}" must have an active mapping.`);
    e.statusCode = 400;
    throw e;
  }
  for (const m of activeMaps) {
    if (m.IsRequired && (m.DefaultValue == null || m.DefaultValue === "") && !m.SourceColumn) {
      const e = new Error(`Required mapping missing source for ${m.DestinationColumn}`);
      e.statusCode = 400;
      throw e;
    }
  }
  return { table, uk, mode, activeMaps };
}

/**
 * Build destination column values for one transformed row.
 * @param {Record<string, unknown>} transformedRow
 * @param {object[]} activeMaps mapping rows from DB
 * @param {Map<string, object>} schemaByCol
 */
function buildDestValues(transformedRow, activeMaps, schemaByCol) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const m of activeMaps) {
    const dest = String(m.DestinationColumn || "").trim();
    const sc = String(m.SourceColumn || "").trim();
    const meta = schemaByCol.get(dest);
    if (!meta) continue;
    let raw;
    if (sc && Object.prototype.hasOwnProperty.call(transformedRow, sc)) {
      raw = transformedRow[sc];
    } else if (m.DefaultValue != null && m.DefaultValue !== "") {
      raw = m.DefaultValue;
    } else {
      raw = undefined;
    }
    if (raw === undefined || raw === null || raw === "") {
      if (m.DefaultValue != null && m.DefaultValue !== "") {
        raw = m.DefaultValue;
      }
    }
    out[dest] = coerceValue(meta, raw);
  }
  return out;
}

/**
 * @param {number} companyId
 * @param {number} dataflowId
 */
async function executeDataflowRun(companyId, dataflowId) {
  const df = await repo.getDataflowById(dataflowId, companyId);
  if (!df) {
    const e = new Error("Dataflow not found");
    e.statusCode = 404;
    throw e;
  }
  const mappings = await repo.listMappings(dataflowId);
  const { table, uk, mode, activeMaps } = validateBeforeRun(df, mappings);

  const schema = await getDboTableSchema(table);
  const schemaByCol = new Map(schema.map((c) => [c.column, c]));
  validateColumnsAgainstSchema(
    schema,
    activeMaps.map((m) => String(m.DestinationColumn || "").trim())
  );

  const ukMeta = schemaByCol.get(uk);
  if (!ukMeta || ukMeta.isIdentity || ukMeta.isComputed) {
    const e = new Error("Unique key must be a non-identity, non-computed column.");
    e.statusCode = 400;
    throw e;
  }

  const runRow = await repo.insertRun({ dataflowId, companyId });
  const runId = runRow.Id;

  const maxRows = Number.isFinite(MAX_ROWS_DEFAULT) && MAX_ROWS_DEFAULT > 0 ? MAX_ROWS_DEFAULT : 25000;
  let totalRead = 0;
  /** @type {Record<string, unknown>[]} */
  let transformed = [];

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const started = new Date();

  try {
    const wb = await readExcelWorkbookPreview(df.SourceType, df.SourcePath, maxRows);
    const defaultName = String(df.SheetName || "").trim() || wb.defaultSheet;
    const initialRows = wb.sheets[defaultName]?.rows ?? wb.sheets[wb.defaultSheet]?.rows ?? [];
    totalRead = Object.values(wb.sheets).reduce((a, s) => a + (s.rowCount || 0), 0);
    const sheets = sheetsForEngine(wb.sheets);
    const eng = runTransformationEngine(df.TransformationScript || "", initialRows, {
      sheets,
      sheetNames: wb.sheetNames || []
    });
    if (!eng.ok) {
      const e = new Error(eng.error || "Transformation failed");
      e.statusCode = 400;
      throw e;
    }
    transformed = eng.rows;
    const pool = await getPool();
    let rowNum = 0;
    for (const row of transformed) {
      rowNum += 1;
      let destValues;
      try {
        destValues = buildDestValues(row, activeMaps, schemaByCol);
      } catch (e) {
        failed += 1;
        await repo.insertRunError({
          runId,
          rowNumber: rowNum,
          uniqueKeyValue: null,
          errorMessage: e.message || "Map error",
          rawRowJson: JSON.stringify(row).slice(0, 8000)
        });
        continue;
      }

      const ukVal = destValues[uk];
      if (ukVal == null || String(ukVal).trim() === "") {
        skipped += 1;
        await repo.insertRunError({
          runId,
          rowNumber: rowNum,
          uniqueKeyValue: null,
          errorMessage: "Skipped: unique key is blank",
          rawRowJson: JSON.stringify(row).slice(0, 8000)
        });
        continue;
      }

      for (const m of activeMaps) {
        if (!m.IsRequired) continue;
        const d = String(m.DestinationColumn || "").trim();
        const v = destValues[d];
        if (v == null || v === "") {
          failed += 1;
          await repo.insertRunError({
            runId,
            rowNumber: rowNum,
            uniqueKeyValue: String(ukVal),
            errorMessage: `Required destination column empty: ${d}`,
            rawRowJson: JSON.stringify(row).slice(0, 8000)
          });
          destValues = null;
          break;
        }
      }
      if (!destValues) continue;

      try {
        const result = await upsertRow(pool, table, schema, mode, uk, destValues);
        if (result === "inserted") inserted += 1;
        else if (result === "updated") updated += 1;
        else skipped += 1;
      } catch (e) {
        failed += 1;
        await repo.insertRunError({
          runId,
          rowNumber: rowNum,
          uniqueKeyValue: String(ukVal),
          errorMessage: e.message || "Upsert failed",
          rawRowJson: JSON.stringify(row).slice(0, 8000)
        });
      }
    }

    const finished = new Date();
    let status = "Success";
    if (failed > 0 && inserted + updated > 0) status = "Partial";
    else if (failed > 0) status = "Failed";
    const logObj = {
      totalRowsRead: totalRead,
      transformedRows: transformed.length,
      inserted,
      updated,
      skipped,
      failed,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString()
    };
    await repo.updateRunById(runId, {
      finishedAt: finished,
      status,
      totalRows: transformed.length,
      insertedRows: inserted,
      updatedRows: updated,
      skippedRows: skipped,
      failedRows: failed,
      errorMessage: failed > 0 ? `${failed} row(s) failed` : null,
      logJson: JSON.stringify(logObj)
    });
    await repo.touchDataflowLastRun(dataflowId, companyId, {
      lastRunAt: finished,
      lastRunStatus: status,
      lastRunMessage: failed > 0 ? `${failed} failed, ${inserted} inserted, ${updated} updated` : "OK"
    });

    return { runId, ...logObj, status };
  } catch (e) {
    const finished = new Date();
    const totalT = typeof transformed !== "undefined" ? transformed.length : 0;
    await repo.updateRunById(runId, {
      finishedAt: finished,
      status: "Failed",
      totalRows: totalT,
      insertedRows: inserted,
      updatedRows: updated,
      skippedRows: skipped,
      failedRows: failed,
      errorMessage: e.message || "Run failed",
      logJson: JSON.stringify({ error: String(e.message) })
    });
    await repo.touchDataflowLastRun(dataflowId, companyId, {
      lastRunAt: finished,
      lastRunStatus: "Failed",
      lastRunMessage: e.message || "Failed"
    });
    throw e;
  }
}

module.exports = {
  previewTransformation,
  executeDataflowRun,
  validateBeforeRun
};
