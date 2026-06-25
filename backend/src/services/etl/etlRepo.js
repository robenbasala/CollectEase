"use strict";

const { sql, query } = require("../../db");
const { encrypt, decrypt } = require("../../helpers/etlSecretCrypto");

function connDto(row, includeSecret = false) {
  if (!row) return null;
  return {
    id: row.Id ?? row.id,
    name: row.Name ?? row.name,
    environmentUrl: row.EnvironmentUrl ?? row.environmentUrl,
    tenantId: row.TenantId ?? row.tenantId,
    clientId: row.ClientId ?? row.clientId,
    companyId: row.CompanyId ?? row.companyId ?? null,
    hasSecret: Boolean(row.ClientSecretEncrypted ?? row.clientSecretEncrypted),
    clientSecret: includeSecret ? undefined : undefined,
    createdAt: row.CreatedAt ?? row.createdAt,
    updatedAt: row.UpdatedAt ?? row.updatedAt
  };
}

async function listConnections(companyId) {
  const inputs = {};
  let where = "";
  if (companyId != null) {
    where = " WHERE CompanyId = @companyId OR CompanyId IS NULL";
    inputs.companyId = { type: sql.Int, value: companyId };
  }
  const r = await query(
    `SELECT Id, Name, EnvironmentUrl, TenantId, ClientId, CompanyId, CreatedAt, UpdatedAt,
            CASE WHEN ClientSecretEncrypted IS NOT NULL AND LEN(ClientSecretEncrypted) > 0 THEN 1 ELSE 0 END AS hasSecret
     FROM dbo.EtlDataverseConnections${where}
     ORDER BY Name`,
    inputs
  );
  return (r.recordset || []).map((row) => ({
    id: row.Id,
    name: row.Name,
    environmentUrl: row.EnvironmentUrl,
    tenantId: row.TenantId,
    clientId: row.ClientId,
    companyId: row.CompanyId,
    hasSecret: Number(row.hasSecret) === 1,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt
  }));
}

async function getConnectionById(id) {
  const r = await query(`SELECT * FROM dbo.EtlDataverseConnections WHERE Id = @id`, {
    id: { type: sql.Int, value: id }
  });
  return r.recordset[0] || null;
}

function credsFromRow(row) {
  return {
    tenantId: row.TenantId,
    clientId: row.ClientId,
    clientSecret: decrypt(row.ClientSecretEncrypted),
    environmentUrl: row.EnvironmentUrl
  };
}

async function createConnection(body, companyId) {
  const secret = encrypt(body.clientSecret);
  const r = await query(
    `INSERT INTO dbo.EtlDataverseConnections (Name, EnvironmentUrl, TenantId, ClientId, ClientSecretEncrypted, CompanyId)
     OUTPUT INSERTED.Id AS id
     VALUES (@name, @url, @tenantId, @clientId, @secret, @companyId)`,
    {
      name: { type: sql.NVarChar(200), value: String(body.name || "Dataverse").trim() },
      url: { type: sql.NVarChar(500), value: String(body.environmentUrl || "").trim() },
      tenantId: { type: sql.NVarChar(200), value: String(body.tenantId || "").trim() },
      clientId: { type: sql.NVarChar(200), value: String(body.clientId || "").trim() },
      secret: { type: sql.NVarChar(sql.MAX), value: secret },
      companyId: { type: sql.Int, value: companyId ?? null }
    }
  );
  return r.recordset[0]?.id;
}

async function updateConnection(id, body) {
  const sets = ["UpdatedAt = SYSUTCDATETIME()"];
  const inputs = { id: { type: sql.Int, value: id } };
  if (body.name != null) {
    sets.push("Name = @name");
    inputs.name = { type: sql.NVarChar(200), value: String(body.name).trim() };
  }
  if (body.environmentUrl != null) {
    sets.push("EnvironmentUrl = @url");
    inputs.url = { type: sql.NVarChar(500), value: String(body.environmentUrl).trim() };
  }
  if (body.tenantId != null) {
    sets.push("TenantId = @tenantId");
    inputs.tenantId = { type: sql.NVarChar(200), value: String(body.tenantId).trim() };
  }
  if (body.clientId != null) {
    sets.push("ClientId = @clientId");
    inputs.clientId = { type: sql.NVarChar(200), value: String(body.clientId).trim() };
  }
  if (body.clientSecret) {
    sets.push("ClientSecretEncrypted = @secret");
    inputs.secret = { type: sql.NVarChar(sql.MAX), value: encrypt(body.clientSecret) };
  }
  await query(`UPDATE dbo.EtlDataverseConnections SET ${sets.join(", ")} WHERE Id = @id`, inputs);
}

async function deleteConnection(id) {
  await query(`DELETE FROM dbo.EtlDataverseConnections WHERE Id = @id`, {
    id: { type: sql.Int, value: id }
  });
}

async function listMappings(companyId) {
  const inputs = {};
  let where = "";
  if (companyId != null) {
    where = " WHERE m.CompanyId = @companyId OR m.CompanyId IS NULL";
    inputs.companyId = { type: sql.Int, value: companyId };
  }
  const r = await query(
    `SELECT m.*, c.Name AS ConnectionName
     FROM dbo.EtlDataverseMappings m
     INNER JOIN dbo.EtlDataverseConnections c ON c.Id = m.ConnectionId
     ${where}
     ORDER BY m.Name`,
    inputs
  );
  return r.recordset || [];
}

async function getMappingById(id) {
  const r = await query(`SELECT * FROM dbo.EtlDataverseMappings WHERE Id = @id`, {
    id: { type: sql.Int, value: id }
  });
  return r.recordset[0] || null;
}

async function createMapping(body) {
  const r = await query(
    `INSERT INTO dbo.EtlDataverseMappings
      (Name, ConnectionId, SourceTableLogicalName, SourceEntitySetName, DestinationTable,
       UniqueKeyJson, MappingJson, ImportMode, CompanyId, BatchSize,
       ScheduleType, ScheduleValue, IsEnabled)
     OUTPUT INSERTED.Id AS id
     VALUES (@name, @connectionId, @srcTable, @entitySet, @dest, @uk, @map, @mode, @companyId, @batch,
             @scheduleType, @scheduleValue, @isEnabled)`,
    {
      name: { type: sql.NVarChar(200), value: body.name },
      connectionId: { type: sql.Int, value: body.connectionId },
      srcTable: { type: sql.NVarChar(200), value: body.sourceTableLogicalName },
      entitySet: { type: sql.NVarChar(200), value: body.sourceEntitySetName || null },
      dest: { type: sql.NVarChar(200), value: body.destinationTable || "DataTbl" },
      uk: { type: sql.NVarChar(sql.MAX), value: body.uniqueKeyJson },
      map: { type: sql.NVarChar(sql.MAX), value: body.mappingJson },
      mode: { type: sql.NVarChar(50), value: body.importMode || "upsert" },
      companyId: { type: sql.Int, value: body.companyId ?? null },
      batch: { type: sql.Int, value: body.batchSize || 500 },
      scheduleType: { type: sql.NVarChar(32), value: String(body.scheduleType || "manual") },
      scheduleValue: {
        type: sql.NVarChar(200),
        value: body.scheduleValue != null ? String(body.scheduleValue).slice(0, 200) : null
      },
      isEnabled: { type: sql.Bit, value: body.isEnabled !== false ? 1 : 0 }
    }
  );
  return r.recordset[0]?.id;
}

async function updateMapping(id, body) {
  const sets = ["UpdatedAt = SYSUTCDATETIME()"];
  const inputs = { id: { type: sql.Int, value: id } };
  const fields = [
    ["name", "Name", sql.NVarChar(200)],
    ["sourceTableLogicalName", "SourceTableLogicalName", sql.NVarChar(200)],
    ["sourceEntitySetName", "SourceEntitySetName", sql.NVarChar(200)],
    ["destinationTable", "DestinationTable", sql.NVarChar(200)],
    ["uniqueKeyJson", "UniqueKeyJson", sql.NVarChar(sql.MAX)],
    ["mappingJson", "MappingJson", sql.NVarChar(sql.MAX)],
    ["importMode", "ImportMode", sql.NVarChar(50)],
    ["batchSize", "BatchSize", sql.Int],
    ["scheduleType", "ScheduleType", sql.NVarChar(32)],
    ["scheduleValue", "ScheduleValue", sql.NVarChar(200)],
    ["isEnabled", "IsEnabled", sql.Bit]
  ];
  for (const [key, col, type] of fields) {
    if (body[key] !== undefined) {
      sets.push(`${col} = @${key}`);
      inputs[key] = { type, value: body[key] };
    }
  }
  await query(`UPDATE dbo.EtlDataverseMappings SET ${sets.join(", ")} WHERE Id = @id`, inputs);
}

async function deleteMapping(id) {
  await query(`DELETE FROM dbo.EtlDataverseMappings WHERE Id = @id`, {
    id: { type: sql.Int, value: id }
  });
}

async function createImportLog(row) {
  const r = await query(
    `INSERT INTO dbo.EtlImportLogs
      (MappingId, ConnectionId, SourceTableLogicalName, DestinationTable, Status, CreatedBy, CompanyId, TriggerType)
     OUTPUT INSERTED.Id AS id
     VALUES (@mappingId, @connectionId, @src, @dest, @status, @by, @companyId, @triggerType)`,
    {
      mappingId: { type: sql.Int, value: row.mappingId ?? null },
      connectionId: { type: sql.Int, value: row.connectionId ?? null },
      src: { type: sql.NVarChar(200), value: row.sourceTableLogicalName ?? null },
      dest: { type: sql.NVarChar(200), value: row.destinationTable ?? null },
      status: { type: sql.NVarChar(50), value: row.status || "Running" },
      by: { type: sql.NVarChar(200), value: row.createdBy ?? null },
      companyId: { type: sql.Int, value: row.companyId ?? null },
      triggerType: { type: sql.NVarChar(32), value: row.triggerType ?? null }
    }
  );
  return r.recordset[0]?.id;
}

async function updateImportLog(id, patch) {
  const sets = [];
  const inputs = { id: { type: sql.Int, value: id } };
  const map = {
    status: ["Status", sql.NVarChar(50)],
    finishedAt: ["FinishedAt", sql.DateTime2],
    totalRead: ["TotalRead", sql.Int],
    totalInserted: ["TotalInserted", sql.Int],
    totalUpdated: ["TotalUpdated", sql.Int],
    totalSkipped: ["TotalSkipped", sql.Int],
    totalErrors: ["TotalErrors", sql.Int],
    errorSummary: ["ErrorSummary", sql.NVarChar(sql.MAX)]
  };
  for (const [k, [col, type]] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      sets.push(`${col} = @${k}`);
      inputs[k] = { type, value: patch[k] };
    }
  }
  if (sets.length === 0) return;
  await query(`UPDATE dbo.EtlImportLogs SET ${sets.join(", ")} WHERE Id = @id`, inputs);
}

async function addLogDetail(detail) {
  await query(
    `INSERT INTO dbo.EtlImportLogDetails (ImportLogId, RowNumber, SourceRecordId, Status, ErrorMessage, SourceJson)
     VALUES (@logId, @row, @sid, @status, @err, @json)`,
    {
      logId: { type: sql.Int, value: detail.importLogId },
      row: { type: sql.Int, value: detail.rowNumber ?? null },
      sid: { type: sql.NVarChar(200), value: detail.sourceRecordId ?? null },
      status: { type: sql.NVarChar(50), value: detail.status },
      err: { type: sql.NVarChar(sql.MAX), value: detail.errorMessage ?? null },
      json: { type: sql.NVarChar(sql.MAX), value: detail.sourceJson ?? null }
    }
  );
}

async function listImportLogs(companyId, limit = 50) {
  const inputs = { limit: { type: sql.Int, value: limit } };
  let where = "";
  if (companyId != null) {
    where = " WHERE CompanyId = @companyId";
    inputs.companyId = { type: sql.Int, value: companyId };
  }
  const r = await query(
    `SELECT TOP (@limit) * FROM dbo.EtlImportLogs${where} ORDER BY StartedAt DESC`,
    inputs
  );
  return r.recordset || [];
}

async function listImportLogsByMapping(companyId, mappingId, limit = 50) {
  const inputs = {
    limit: { type: sql.Int, value: limit },
    mappingId: { type: sql.Int, value: mappingId }
  };
  let where = " WHERE MappingId = @mappingId";
  if (companyId != null) {
    where += " AND CompanyId = @companyId";
    inputs.companyId = { type: sql.Int, value: companyId };
  }
  const r = await query(
    `SELECT TOP (@limit) * FROM dbo.EtlImportLogs${where} ORDER BY StartedAt DESC`,
    inputs
  );
  return r.recordset || [];
}

async function getImportLog(id) {
  const r = await query(`SELECT * FROM dbo.EtlImportLogs WHERE Id = @id`, {
    id: { type: sql.Int, value: id }
  });
  return r.recordset[0] || null;
}

async function mappingBelongsToCompany(mappingRow, companyId) {
  if (!mappingRow) return false;
  const cid = mappingRow.CompanyId ?? mappingRow.companyId;
  if (cid == null) return true;
  return Number(cid) === Number(companyId);
}

async function listEnabledScheduledMappings() {
  const r = await query(
    `SELECT m.Id, m.CompanyId, m.ConnectionId, m.ScheduleType, m.ScheduleValue, m.IsEnabled, m.LastRunAt
     FROM dbo.EtlDataverseMappings m
     WHERE m.IsEnabled = 1
       AND LOWER(ISNULL(m.ScheduleType, N'manual')) <> N'manual'
       AND m.CompanyId IS NOT NULL`,
    {}
  );
  return r.recordset || [];
}

async function touchMappingLastRun(mappingId, patch) {
  const sets = ["LastRunAt = SYSUTCDATETIME()"];
  const inputs = { id: { type: sql.Int, value: mappingId } };
  if (patch.lastRunStatus != null) {
    sets.push("LastRunStatus = @lastRunStatus");
    inputs.lastRunStatus = { type: sql.NVarChar(50), value: String(patch.lastRunStatus) };
  }
  await query(`UPDATE dbo.EtlDataverseMappings SET ${sets.join(", ")} WHERE Id = @id`, inputs);
}

async function listImportLogDetails(importLogId, limit = 200) {
  const r = await query(
    `SELECT TOP (@limit) * FROM dbo.EtlImportLogDetails WHERE ImportLogId = @id ORDER BY Id`,
    { id: { type: sql.Int, value: importLogId }, limit: { type: sql.Int, value: limit } }
  );
  return r.recordset || [];
}

module.exports = {
  listConnections,
  getConnectionById,
  credsFromRow,
  createConnection,
  updateConnection,
  deleteConnection,
  listMappings,
  getMappingById,
  createMapping,
  updateMapping,
  deleteMapping,
  createImportLog,
  updateImportLog,
  addLogDetail,
  listImportLogs,
  listImportLogsByMapping,
  getImportLog,
  listImportLogDetails,
  mappingBelongsToCompany,
  listEnabledScheduledMappings,
  touchMappingLastRun
};
