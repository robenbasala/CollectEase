"use strict";

const { sql, getPool } = require("../../db");
const { coerceValue, coerceSqlType } = require("../dataflowUpsertService");

function bracket(ident) {
  return `[${String(ident).replace(/]/g, "]]")}]`;
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} tableName
 * @param {object[]} schema
 * @param {string} importMode insert_only | upsert | delete_reload handled outside
 * @param {string[]} uniqueKeyColumns
 * @param {Record<string, unknown>} destValues
 * @param {number|null} companyId
 */
async function upsertDataTblRow(pool, tableName, schema, importMode, uniqueKeyColumns, destValues, companyId) {
  const byCol = new Map(schema.map((c) => [c.column, c]));
  const ukCols = uniqueKeyColumns.map((c) => String(c).trim()).filter(Boolean);
  for (const uk of ukCols) {
    if (!byCol.has(uk) || byCol.get(uk).isIdentity) {
      const e = new Error(`Invalid unique key column: ${uk}`);
      e.code = "BAD_UK";
      throw e;
    }
  }
  if (ukCols.length === 0) {
    const e = new Error("At least one unique key column is required");
    e.code = "BAD_UK";
    throw e;
  }

  for (const uk of ukCols) {
    const v = destValues[uk];
    if (v == null || String(v).trim() === "") return "skipped";
  }

  const writable = schema.filter((c) => !c.isIdentity && !c.isComputed);
  const updateCols = writable.filter((c) => !ukCols.includes(c.column));

  const tRef = `${bracket("dbo")}.${bracket(tableName)}`;
  const req = pool.request();

  const colParams = [];
  let i = 0;
  for (const c of writable) {
    const pname = `p${i++}`;
    const val = Object.prototype.hasOwnProperty.call(destValues, c.column) ? destValues[c.column] : null;
    const coerced = coerceValue(c, val);
    req.input(pname, coerceSqlType(c), coerced);
    colParams.push({ col: c.column, pname });
  }

  const srcSelect = colParams.map((x) => `@${x.pname} AS ${bracket(x.col)}`).join(", ");

  const onParts = ukCols.map((uk) => {
    const meta = byCol.get(uk);
    const p = colParams.find((x) => x.col === uk);
    return `tgt.${bracket(uk)} = src.${bracket(uk)}`;
  });
  if (companyId != null && byCol.has("CompanyId")) {
    onParts.push(`tgt.${bracket("CompanyId")} = @etlCompanyId`);
    req.input("etlCompanyId", sql.Int, companyId);
  }
  const onClause = onParts.join(" AND ");

  let mergeSql;
  if (importMode === "insert_only") {
    const insertList = writable.map((c) => bracket(c.column)).join(", ");
    const insertVals = writable.map((c) => `src.${bracket(c.column)}`).join(", ");
    mergeSql = `
      MERGE ${tRef} AS tgt
      USING (SELECT ${srcSelect}) AS src ON (${onClause})
      WHEN NOT MATCHED BY TARGET THEN INSERT (${insertList}) VALUES (${insertVals})
      OUTPUT $action AS act;`;
  } else {
    const sets =
      updateCols.length > 0
        ? updateCols.map((c) => `tgt.${bracket(c.column)} = src.${bracket(c.column)}`).join(", ")
        : ukCols.map((uk) => `tgt.${bracket(uk)} = src.${bracket(uk)}`).join(", ");
    const insertList = writable.map((c) => bracket(c.column)).join(", ");
    const insertVals = writable.map((c) => `src.${bracket(c.column)}`).join(", ");
    mergeSql = `
      MERGE ${tRef} AS tgt
      USING (SELECT ${srcSelect}) AS src ON (${onClause})
      WHEN MATCHED THEN UPDATE SET ${sets}
      WHEN NOT MATCHED BY TARGET THEN INSERT (${insertList}) VALUES (${insertVals})
      OUTPUT $action AS act;`;
  }

  const res = await req.query(mergeSql);
  const act = res.recordset?.[0] ? String(res.recordset[0].act || "") : "";
  if (act === "INSERT") return "inserted";
  if (act === "UPDATE") return "updated";
  return "skipped";
}

async function deleteCompanyRows(pool, tableName, companyId) {
  if (companyId == null) return;
  await pool
    .request()
    .input("cid", sql.Int, companyId)
    .query(`DELETE FROM ${bracket("dbo")}.${bracket(tableName)} WHERE ${bracket("CompanyId")} = @cid`);
}

module.exports = { upsertDataTblRow, deleteCompanyRows };
