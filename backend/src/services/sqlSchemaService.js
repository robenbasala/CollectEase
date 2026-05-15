"use strict";

const { sql, query } = require("../db");

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeIdent(name, label) {
  const s = String(name || "").trim();
  if (!IDENT.test(s)) {
    const e = new Error(`Invalid ${label} identifier`);
    e.code = "BAD_IDENT";
    throw e;
  }
  return s;
}

/**
 * List user tables in dbo.
 */
async function listDboTables() {
  const r = await query(
    `SELECT TABLE_NAME AS name
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = N'dbo' AND TABLE_TYPE = N'BASE TABLE'
     ORDER BY TABLE_NAME`,
    {}
  );
  return (r.recordset || []).map((row) => String(row.name ?? "").trim()).filter(Boolean);
}

/**
 * @param {string} tableName
 * @returns {Promise<{ column: string, dataType: string, maxLength: number|null, isNullable: boolean, isIdentity: boolean }[]>}
 */
async function getDboTableSchema(tableName) {
  const t = assertSafeIdent(tableName, "table");
  const chk = await query(
    `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @t`,
    { t: { type: sql.NVarChar(256), value: t } }
  );
  if (Number(chk.recordset[0]?.c ?? 0) < 1) {
    const e = new Error("Table not found in dbo");
    e.code = "NO_TABLE";
    throw e;
  }

  const cols = await query(
    `SELECT c.COLUMN_NAME AS columnName, c.DATA_TYPE AS dataType, c.CHARACTER_MAXIMUM_LENGTH AS maxLen,
            c.IS_NULLABLE AS isNullable,
            COLUMNPROPERTY(OBJECT_ID(QUOTENAME(N'dbo') + N'.' + QUOTENAME(@t)), c.COLUMN_NAME, N'IsIdentity') AS isIdentity,
            COLUMNPROPERTY(OBJECT_ID(QUOTENAME(N'dbo') + N'.' + QUOTENAME(@t)), c.COLUMN_NAME, N'IsComputed') AS isComputed
     FROM INFORMATION_SCHEMA.COLUMNS c
     WHERE c.TABLE_SCHEMA = N'dbo' AND c.TABLE_NAME = @t
     ORDER BY c.ORDINAL_POSITION`,
    { t: { type: sql.NVarChar(256), value: t } }
  );

  /** @type {{ name: string, isPk: boolean }[]} */
  let pkCols = [];
  try {
    const pk = await query(
      `SELECT kcu.COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.TABLE_SCHEMA = N'dbo' AND tc.TABLE_NAME = @t AND tc.CONSTRAINT_TYPE = N'PRIMARY KEY'
       ORDER BY kcu.ORDINAL_POSITION`,
      { t: { type: sql.NVarChar(256), value: t } }
    );
    pkCols = (pk.recordset || []).map((r) => ({ name: String(r.columnName || ""), isPk: true }));
  } catch {
    pkCols = [];
  }
  const pkSet = new Set(pkCols.map((p) => p.name));

  return (cols.recordset || []).map((row) => {
    const column = String(row.columnName ?? "").trim();
    const dataType = String(row.dataType ?? "").toLowerCase();
    const maxLen = row.maxLen == null ? null : Number(row.maxLen);
    return {
      column,
      dataType,
      maxLength: Number.isFinite(maxLen) ? maxLen : null,
      isNullable: String(row.isNullable || "").toUpperCase() === "YES",
      isIdentity: Number(row.isIdentity ?? 0) === 1,
      isComputed: Number(row.isComputed ?? 0) === 1,
      isPrimaryKey: pkSet.has(column)
    };
  });
}

/**
 * @param {string} tableName
 * @param {string[]} columnNames
 */
function validateColumnsAgainstSchema(schema, columnNames) {
  const allowed = new Map(schema.map((c) => [c.column, c]));
  const out = [];
  for (const raw of columnNames) {
    const c = String(raw || "").trim();
    if (!IDENT.test(c)) {
      const e = new Error(`Invalid column name: ${raw}`);
      e.code = "BAD_IDENT";
      throw e;
    }
    if (!allowed.has(c)) {
      const e = new Error(`Column not in destination schema: ${c}`);
      e.code = "BAD_COLUMN";
      throw e;
    }
    out.push(allowed.get(c));
  }
  return out;
}

module.exports = {
  listDboTables,
  getDboTableSchema,
  assertSafeIdent,
  validateColumnsAgainstSchema,
  IDENT
};
