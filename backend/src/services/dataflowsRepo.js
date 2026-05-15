"use strict";

const { sql, query } = require("../db");

/**
 * @param {number} companyId
 */
async function listDataflows(companyId) {
  const r = await query(
    `SELECT d.Id, d.CompanyId, d.Name, d.Description, d.SourceType, d.SourcePath, d.SheetName, d.ExcelTableName,
            d.DestinationTable, d.UniqueKeyColumn, d.UpsertMode, d.ScheduleType, d.ScheduleValue, d.IsEnabled,
            d.CreatedAt, d.UpdatedAt, d.LastRunAt, d.LastRunStatus, d.LastRunMessage
     FROM dbo.CompanyDataflow d
     WHERE d.CompanyId = @companyId
     ORDER BY d.Name, d.Id`,
    { companyId: { type: sql.Int, value: companyId } }
  );
  return r.recordset || [];
}

/**
 * @param {number} id
 * @param {number} companyId
 */
async function getDataflowById(id, companyId) {
  const r = await query(
    `SELECT d.* FROM dbo.CompanyDataflow d WHERE d.Id = @id AND d.CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return r.recordset[0] || null;
}

/**
 * @param {number} dataflowId
 */
async function listMappings(dataflowId) {
  const r = await query(
    `SELECT Id, DataflowId, SourceColumn, DestinationColumn, DestinationDataType, IsRequired, IsMapped,
            DefaultValue, Expression, CreatedAt, UpdatedAt
     FROM dbo.CompanyDataflowMapping
     WHERE DataflowId = @dataflowId
     ORDER BY DestinationColumn`,
    { dataflowId: { type: sql.Int, value: dataflowId } }
  );
  return r.recordset || [];
}

/**
 * @param {object} body
 */
async function insertDataflow(companyId, body) {
  const r = await query(
    `INSERT INTO dbo.CompanyDataflow (
       CompanyId, Name, Description, SourceType, SourcePath, SheetName, ExcelTableName,
       TransformationScript, DestinationTable, UniqueKeyColumn, UpsertMode,
       ScheduleType, ScheduleValue, IsEnabled
     ) OUTPUT INSERTED.*
     VALUES (
       @companyId, @name, @description, @sourceType, @sourcePath, @sheetName, @excelTableName,
       @transformationScript, @destinationTable, @uniqueKeyColumn, @upsertMode,
       @scheduleType, @scheduleValue, @isEnabled
     )`,
    {
      companyId: { type: sql.Int, value: companyId },
      name: { type: sql.NVarChar(500), value: String(body.name || "").slice(0, 500) },
      description: { type: sql.NVarChar(sql.MAX), value: body.description != null ? String(body.description) : null },
      sourceType: { type: sql.NVarChar(32), value: String(body.sourceType || "local_path") },
      sourcePath: { type: sql.NVarChar(2000), value: String(body.sourcePath || "") },
      sheetName: { type: sql.NVarChar(200), value: body.sheetName != null ? String(body.sheetName).slice(0, 200) : null },
      excelTableName: {
        type: sql.NVarChar(200),
        value: body.excelTableName != null ? String(body.excelTableName).slice(0, 200) : null
      },
      transformationScript: {
        type: sql.NVarChar(sql.MAX),
        value: body.transformationScript != null ? String(body.transformationScript) : null
      },
      destinationTable: { type: sql.NVarChar(256), value: String(body.destinationTable || "").slice(0, 256) },
      uniqueKeyColumn: { type: sql.NVarChar(128), value: String(body.uniqueKeyColumn || "").slice(0, 128) },
      upsertMode: { type: sql.NVarChar(32), value: String(body.upsertMode || "insert_update") },
      scheduleType: { type: sql.NVarChar(32), value: String(body.scheduleType || "manual") },
      scheduleValue: {
        type: sql.NVarChar(200),
        value: body.scheduleValue != null ? String(body.scheduleValue).slice(0, 200) : null
      },
      isEnabled: { type: sql.Bit, value: body.isEnabled === false ? 0 : 1 }
    }
  );
  return r.recordset[0];
}

async function updateDataflow(id, companyId, body) {
  await query(
    `UPDATE dbo.CompanyDataflow SET
       Name = @name,
       Description = @description,
       SourceType = @sourceType,
       SourcePath = @sourcePath,
       SheetName = @sheetName,
       ExcelTableName = @excelTableName,
       TransformationScript = @transformationScript,
       DestinationTable = @destinationTable,
       UniqueKeyColumn = @uniqueKeyColumn,
       UpsertMode = @upsertMode,
       ScheduleType = @scheduleType,
       ScheduleValue = @scheduleValue,
       IsEnabled = @isEnabled,
       UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: companyId },
      name: { type: sql.NVarChar(500), value: String(body.name || "").slice(0, 500) },
      description: { type: sql.NVarChar(sql.MAX), value: body.description != null ? String(body.description) : null },
      sourceType: { type: sql.NVarChar(32), value: String(body.sourceType || "local_path") },
      sourcePath: { type: sql.NVarChar(2000), value: String(body.sourcePath || "") },
      sheetName: { type: sql.NVarChar(200), value: body.sheetName != null ? String(body.sheetName).slice(0, 200) : null },
      excelTableName: {
        type: sql.NVarChar(200),
        value: body.excelTableName != null ? String(body.excelTableName).slice(0, 200) : null
      },
      transformationScript: {
        type: sql.NVarChar(sql.MAX),
        value: body.transformationScript != null ? String(body.transformationScript) : null
      },
      destinationTable: { type: sql.NVarChar(256), value: String(body.destinationTable || "").slice(0, 256) },
      uniqueKeyColumn: { type: sql.NVarChar(128), value: String(body.uniqueKeyColumn || "").slice(0, 128) },
      upsertMode: { type: sql.NVarChar(32), value: String(body.upsertMode || "insert_update") },
      scheduleType: { type: sql.NVarChar(32), value: String(body.scheduleType || "manual") },
      scheduleValue: {
        type: sql.NVarChar(200),
        value: body.scheduleValue != null ? String(body.scheduleValue).slice(0, 200) : null
      },
      isEnabled: { type: sql.Bit, value: body.isEnabled === false ? 0 : 1 }
    }
  );
  return getDataflowById(id, companyId);
}

async function deleteDataflow(id, companyId) {
  await query(`DELETE FROM dbo.CompanyDataflow WHERE Id = @id AND CompanyId = @companyId`, {
    id: { type: sql.Int, value: id },
    companyId: { type: sql.Int, value: companyId }
  });
}

async function replaceMappings(dataflowId, mappings) {
  await query(`DELETE FROM dbo.CompanyDataflowMapping WHERE DataflowId = @dataflowId`, {
    dataflowId: { type: sql.Int, value: dataflowId }
  });
  for (const m of mappings || []) {
    await query(
      `INSERT INTO dbo.CompanyDataflowMapping (
         DataflowId, SourceColumn, DestinationColumn, DestinationDataType, IsRequired, IsMapped, DefaultValue, Expression
       ) VALUES (
         @dataflowId, @sourceColumn, @destinationColumn, @destinationDataType, @isRequired, @isMapped, @defaultValue, @expression
       )`,
      {
        dataflowId: { type: sql.Int, value: dataflowId },
        sourceColumn: { type: sql.NVarChar(256), value: String(m.sourceColumn || "").slice(0, 256) },
        destinationColumn: { type: sql.NVarChar(256), value: String(m.destinationColumn || "").slice(0, 256) },
        destinationDataType: {
          type: sql.NVarChar(120),
          value: m.destinationDataType != null ? String(m.destinationDataType).slice(0, 120) : null
        },
        isRequired: { type: sql.Bit, value: m.isRequired ? 1 : 0 },
        isMapped: { type: sql.Bit, value: m.isMapped === false ? 0 : 1 },
        defaultValue: {
          type: sql.NVarChar(sql.MAX),
          value: m.defaultValue != null ? String(m.defaultValue) : null
        },
        expression: {
          type: sql.NVarChar(sql.MAX),
          value: m.expression != null ? String(m.expression) : null
        }
      }
    );
  }
}

async function touchDataflowLastRun(id, companyId, { lastRunAt, lastRunStatus, lastRunMessage }) {
  await query(
    `UPDATE dbo.CompanyDataflow SET
       LastRunAt = @lastRunAt,
       LastRunStatus = @lastRunStatus,
       LastRunMessage = @lastRunMessage,
       UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @id AND CompanyId = @companyId`,
    {
      id: { type: sql.Int, value: id },
      companyId: { type: sql.Int, value: companyId },
      lastRunAt: { type: sql.DateTime2, value: lastRunAt },
      lastRunStatus: { type: sql.NVarChar(32), value: lastRunStatus != null ? String(lastRunStatus).slice(0, 32) : null },
      lastRunMessage: {
        type: sql.NVarChar(2000),
        value: lastRunMessage != null ? String(lastRunMessage).slice(0, 2000) : null
      }
    }
  );
}

async function insertRun({ dataflowId, companyId }) {
  const r = await query(
    `INSERT INTO dbo.CompanyDataflowRun (DataflowId, CompanyId, Status)
     OUTPUT INSERTED.*
     VALUES (@dataflowId, @companyId, N'Running')`,
    {
      dataflowId: { type: sql.Int, value: dataflowId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return r.recordset[0];
}

async function updateRunById(runId, patch) {
  await query(
    `UPDATE dbo.CompanyDataflowRun SET
       FinishedAt = @finishedAt,
       Status = @status,
       TotalRows = @totalRows,
       InsertedRows = @insertedRows,
       UpdatedRows = @updatedRows,
       SkippedRows = @skippedRows,
       FailedRows = @failedRows,
       ErrorMessage = @errorMessage,
       LogJson = @logJson
     WHERE Id = @runId`,
    {
      runId: { type: sql.Int, value: runId },
      finishedAt: { type: sql.DateTime2, value: patch.finishedAt != null ? patch.finishedAt : null },
      status: { type: sql.NVarChar(32), value: String(patch.status || "Success").slice(0, 32) },
      totalRows: { type: sql.Int, value: Number(patch.totalRows) || 0 },
      insertedRows: { type: sql.Int, value: Number(patch.insertedRows) || 0 },
      updatedRows: { type: sql.Int, value: Number(patch.updatedRows) || 0 },
      skippedRows: { type: sql.Int, value: Number(patch.skippedRows) || 0 },
      failedRows: { type: sql.Int, value: Number(patch.failedRows) || 0 },
      errorMessage: {
        type: sql.NVarChar(sql.MAX),
        value: patch.errorMessage != null ? String(patch.errorMessage) : null
      },
      logJson: { type: sql.NVarChar(sql.MAX), value: patch.logJson != null ? String(patch.logJson) : null }
    }
  );
}

async function listRuns(dataflowId, companyId, limit = 50) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const r = await query(
    `SELECT TOP (${lim}) *
     FROM dbo.CompanyDataflowRun
     WHERE DataflowId = @dataflowId AND CompanyId = @companyId
     ORDER BY StartedAt DESC`,
    {
      dataflowId: { type: sql.Int, value: dataflowId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return r.recordset || [];
}

async function getRun(runId, companyId) {
  const r = await query(
    `SELECT * FROM dbo.CompanyDataflowRun WHERE Id = @runId AND CompanyId = @companyId`,
    {
      runId: { type: sql.Int, value: runId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  return r.recordset[0] || null;
}

async function listRunErrors(runId, companyId, limit = 500) {
  const ok = await query(
    `SELECT 1 AS x FROM dbo.CompanyDataflowRun WHERE Id = @runId AND CompanyId = @companyId`,
    {
      runId: { type: sql.Int, value: runId },
      companyId: { type: sql.Int, value: companyId }
    }
  );
  if (!ok.recordset.length) return null;
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  const r = await query(
    `SELECT TOP (${lim}) e.*
     FROM dbo.CompanyDataflowRunError e
     WHERE e.RunId = @runId
     ORDER BY e.Id`,
    {
      runId: { type: sql.Int, value: runId }
    }
  );
  return r.recordset || [];
}

async function insertRunError(runId, row) {
  await query(
    `INSERT INTO dbo.CompanyDataflowRunError (RunId, RowNumber, UniqueKeyValue, ErrorMessage, RawRowJson)
     VALUES (@runId, @rowNumber, @uniqueKeyValue, @errorMessage, @rawRowJson)`,
    {
      runId: { type: sql.Int, value: runId },
      rowNumber: { type: sql.Int, value: row.rowNumber != null ? Number(row.rowNumber) : null },
      uniqueKeyValue: {
        type: sql.NVarChar(400),
        value: row.uniqueKeyValue != null ? String(row.uniqueKeyValue).slice(0, 400) : null
      },
      errorMessage: { type: sql.NVarChar(2000), value: String(row.errorMessage || "").slice(0, 2000) },
      rawRowJson: { type: sql.NVarChar(sql.MAX), value: row.rawRowJson != null ? String(row.rawRowJson) : null }
    }
  );
}

async function listEnabledScheduledDataflows() {
  const r = await query(
    `SELECT d.* FROM dbo.CompanyDataflow d
     WHERE d.IsEnabled = 1 AND d.ScheduleType IN (N'interval_minutes', N'hourly', N'daily', N'weekly')`,
    {}
  );
  return r.recordset || [];
}

module.exports = {
  listDataflows,
  getDataflowById,
  listMappings,
  insertDataflow,
  updateDataflow,
  deleteDataflow,
  replaceMappings,
  touchDataflowLastRun,
  insertRun,
  updateRunById,
  listRuns,
  getRun,
  listRunErrors,
  insertRunError,
  listEnabledScheduledDataflows
};
