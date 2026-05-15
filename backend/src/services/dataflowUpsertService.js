"use strict";

const { sql, getPool } = require("../db");

/**
 * @param {{ column: string, dataType: string, maxLength: number|null, isIdentity: boolean, isComputed: boolean }} col
 * @param {unknown} raw
 */
function coerceValue(col, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const dt = String(col.dataType || "").toLowerCase();
  if (dt.includes("int") && !dt.includes("point")) {
    const n = Number(String(raw).replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (dt === "decimal" || dt === "numeric" || dt === "money" || dt === "smallmoney" || dt === "float" || dt === "real") {
    const n = Number(String(raw).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  if (dt === "bit") {
    const s = String(raw).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
    return null;
  }
  if (dt === "date" || dt === "datetime" || dt === "datetime2" || dt === "smalldatetime" || dt === "datetimeoffset") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw);
  const max = col.maxLength != null && col.maxLength > 0 && col.maxLength < 4000 ? col.maxLength : 4000;
  return s.length > max ? s.slice(0, max) : s;
}

function bracket(ident) {
  return `[${String(ident).replace(/]/g, "]]")}]`;
}

/**
 * @param {{ dataType: string, maxLength: number|null }} col
 */
function coerceSqlType(col) {
  const dt = String(col.dataType || "").toLowerCase();
  if (dt === "bit") return sql.Bit;
  if (dt.includes("bigint")) return sql.BigInt;
  if (dt === "int") return sql.Int;
  if (dt === "smallint") return sql.SmallInt;
  if (dt === "tinyint") return sql.TinyInt;
  if (dt === "float") return sql.Float;
  if (dt === "real") return sql.Real;
  if (dt === "decimal" || dt === "numeric") return sql.Decimal(18, 4);
  if (dt === "money" || dt === "smallmoney") return sql.Money;
  if (dt === "datetime2") return sql.DateTime2;
  if (dt === "datetime") return sql.DateTime;
  if (dt === "date") return sql.Date;
  if (dt === "time") return sql.Time;
  if (dt === "datetimeoffset") return sql.DateTimeOffset;
  if (dt === "uniqueidentifier") return sql.UniqueIdentifier;
  const max = col.maxLength != null && col.maxLength > 0 && col.maxLength < 4000 ? col.maxLength : 4000;
  return sql.NVarChar(max);
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} tableName validated identifier
 * @param {object[]} schema from getDboTableSchema
 * @param {'insert_only'|'update_only'|'insert_update'} upsertMode
 * @param {string} uniqueKeyColumn
 * @param {Record<string, unknown>} destValues keyed by destination column
 * @returns {Promise<'inserted'|'updated'|'skipped'>}
 */
async function upsertRow(pool, tableName, schema, upsertMode, uniqueKeyColumn, destValues) {
  const byCol = new Map(schema.map((c) => [c.column, c]));
  const ukMeta = byCol.get(uniqueKeyColumn);
  if (!ukMeta || ukMeta.isIdentity) {
    const e = new Error("Invalid unique key column");
    e.code = "BAD_UK";
    throw e;
  }

  const writable = schema.filter((c) => !c.isIdentity && !c.isComputed);
  const updateCols = writable.filter((c) => c.column !== uniqueKeyColumn);

  const ukVal = destValues[uniqueKeyColumn];
  if (ukVal == null || String(ukVal).trim() === "") {
    return "skipped";
  }

  const tRef = `${bracket("dbo")}.${bracket(tableName)}`;
  const req = pool.request();
  const ukParam = "dfUk";
  req.input(ukParam, coerceSqlType(ukMeta), coerceValue(ukMeta, ukVal));

  /** @type {{ col: string, pname: string }[]} */
  const colParams = [];
  let i = 0;
  for (const c of writable) {
    if (c.column === uniqueKeyColumn) continue;
    const pname = `dfC${i++}`;
    const val = Object.prototype.hasOwnProperty.call(destValues, c.column) ? destValues[c.column] : undefined;
    const coerced = val === undefined ? null : coerceValue(c, val);
    req.input(pname, coerceSqlType(c), coerced);
    colParams.push({ col: c.column, pname });
  }

  const srcSelect = [
    `@${ukParam} AS ${bracket(uniqueKeyColumn)}`,
    ...colParams.map((x) => `@${x.pname} AS ${bracket(x.col)}`)
  ].join(", ");

  let mergeSql;
  if (upsertMode === "insert_only") {
    const insertList = writable.map((c) => bracket(c.column)).join(", ");
    const insertVals = writable.map((c) => `src.${bracket(c.column)}`).join(", ");
    mergeSql = `
        MERGE ${tRef} AS tgt
        USING (SELECT ${srcSelect}) AS src ON (tgt.${bracket(uniqueKeyColumn)} = src.${bracket(uniqueKeyColumn)})
        WHEN NOT MATCHED BY TARGET THEN
          INSERT (${insertList})
          VALUES (${insertVals})
        OUTPUT $action AS act;`;
  } else if (upsertMode === "update_only") {
    const sets =
      updateCols.length > 0
        ? updateCols.map((c) => `tgt.${bracket(c.column)} = src.${bracket(c.column)}`).join(", ")
        : `tgt.${bracket(uniqueKeyColumn)} = src.${bracket(uniqueKeyColumn)}`;
    mergeSql = `
        MERGE ${tRef} AS tgt
        USING (SELECT ${srcSelect}) AS src ON (tgt.${bracket(uniqueKeyColumn)} = src.${bracket(uniqueKeyColumn)})
        WHEN MATCHED THEN UPDATE SET ${sets}
        OUTPUT $action AS act;`;
  } else {
    const sets =
      updateCols.length > 0
        ? updateCols.map((c) => `tgt.${bracket(c.column)} = src.${bracket(c.column)}`).join(", ")
        : `tgt.${bracket(uniqueKeyColumn)} = src.${bracket(uniqueKeyColumn)}`;
    const insertList = writable.map((c) => bracket(c.column)).join(", ");
    const insertVals = writable.map((c) => `src.${bracket(c.column)}`).join(", ");
    mergeSql = `
        MERGE ${tRef} AS tgt
        USING (SELECT ${srcSelect}) AS src ON (tgt.${bracket(uniqueKeyColumn)} = src.${bracket(uniqueKeyColumn)})
        WHEN MATCHED THEN UPDATE SET ${sets}
        WHEN NOT MATCHED BY TARGET THEN INSERT (${insertList}) VALUES (${insertVals})
        OUTPUT $action AS act;`;
  }

  const res = await req.query(mergeSql);
  const act = res.recordset && res.recordset[0] ? String(res.recordset[0].act || "") : "";
  if (act === "INSERT") return "inserted";
  if (act === "UPDATE") return "updated";
  return "skipped";
}

module.exports = {
  upsertRow,
  coerceValue,
  coerceSqlType
};
