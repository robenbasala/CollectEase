"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const colCache = require("exceljs/lib/utils/col-cache");

function parseAllowedRoots() {
  const raw = process.env.DATAFLOW_ALLOWED_LOCAL_PATHS || "";
  return raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
}

function assertAllowedLocalPath(filePath) {
  const roots = parseAllowedRoots();
  if (!roots.length) {
    const e = new Error(
      "Local Excel paths are disabled. Set DATAFLOW_ALLOWED_LOCAL_PATHS to a semicolon-separated list of allowed folders."
    );
    e.code = "LOCAL_PATH_DISABLED";
    throw e;
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    const e = new Error("File not found");
    e.code = "NOT_FOUND";
    throw e;
  }
  const ok = roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
  if (!ok) {
    const e = new Error("Path is outside DATAFLOW_ALLOWED_LOCAL_PATHS");
    e.code = "PATH_NOT_ALLOWED";
    throw e;
  }
  return resolved;
}

function assertHttpUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    const e = new Error("Invalid URL");
    e.code = "BAD_URL";
    throw e;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    const e = new Error("Only http(s) URLs are supported");
    e.code = "BAD_URL";
    throw e;
  }
  return u.toString();
}

function cellText(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object") {
    if (Object.prototype.hasOwnProperty.call(val, "text")) return String(val.text ?? "");
    if (Object.prototype.hasOwnProperty.call(val, "result")) return cellText(val.result);
    if (Object.prototype.hasOwnProperty.call(val, "richText")) {
      return Array.isArray(val.richText) ? val.richText.map((x) => x.text).join("") : "";
    }
  }
  return String(val);
}

function normalizeCellValue(val) {
  if (val && typeof val === "object" && !(val instanceof Date)) {
    if (Object.prototype.hasOwnProperty.call(val, "result")) return normalizeCellValue(val.result);
    if (Object.prototype.hasOwnProperty.call(val, "text")) return val.text;
  }
  if (val instanceof Date) return val.toISOString();
  return val;
}

function dedupeHeaders(headers) {
  const seen = new Set();
  return headers.map((h, i) => {
    let name = (h || "").trim() || `Column${i + 1}`;
    let base = name;
    let n = 1;
    while (seen.has(name)) {
      name = `${base}_${++n}`;
    }
    seen.add(name);
    return name;
  });
}

/**
 * @param {string} ref e.g. "B2:F20"
 */
function parseRangeRef(ref) {
  const s = String(ref || "").trim();
  if (!s) return null;
  const parts = s.includes(":") ? s.split(":") : [s, s];
  const tl = colCache.decodeAddress(parts[0].trim());
  const br = colCache.decodeAddress(parts[1].trim());
  return {
    top: tl.row,
    left: tl.col,
    bottom: br.row,
    right: br.col
  };
}

/**
 * @param {import('exceljs').Worksheet} ws
 * @param {{ top: number, left: number, bottom: number, right: number }} bounds 1-based inclusive
 * @param {number} maxDataRows after header
 */
function readRectAsObjects(ws, bounds, maxDataRows) {
  const headers = [];
  for (let c = bounds.left; c <= bounds.right; c++) {
    const cell = ws.getRow(bounds.top).getCell(c);
    headers.push(cellText(cell.value));
  }
  const unique = dedupeHeaders(headers);
  const rows = [];
  const maxRow = Math.min(bounds.bottom, bounds.top + maxDataRows);
  for (let r = bounds.top + 1; r <= maxRow; r++) {
    /** @type {Record<string, unknown>} */
    const obj = {};
    let any = false;
    for (let c = bounds.left; c <= bounds.right; c++) {
      const key = unique[c - bounds.left];
      const v = normalizeCellValue(ws.getRow(r).getCell(c).value);
      obj[key] = v;
      if (v != null && String(v).trim() !== "") any = true;
    }
    if (any) rows.push(obj);
  }
  return { columns: unique, rows };
}

function sheetAutoBounds(ws) {
  let maxR = 0;
  let maxC = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (row.number > maxR) maxR = row.number;
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      if (colNumber > maxC) maxC = colNumber;
    });
  });
  if (maxR < 1 || maxC < 1) return null;
  return { top: 1, left: 1, bottom: maxR, right: maxC };
}

/**
 * @param {string} sourceType
 * @param {string} sourcePath
 */
async function loadWorkbookBuffer(sourceType, sourcePath) {
  if (sourceType === "local_path") {
    const p = assertAllowedLocalPath(sourcePath);
    return fs.readFileSync(p);
  }
  if (sourceType === "url") {
    const u = assertHttpUrl(sourcePath);
    const res = await fetch(u, { redirect: "follow" });
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status} loading URL`);
      e.code = "HTTP";
      throw e;
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  if (sourceType === "sharepoint") {
    const e = new Error(
      "SharePoint / OneDrive sources are not implemented yet. Use a public https URL that returns the .xlsx file."
    );
    e.code = "NOT_IMPLEMENTED";
    throw e;
  }
  const e = new Error("Unsupported source type");
  e.code = "BAD_SOURCE";
  throw e;
}

/**
 * @param {string} sourceType
 * @param {string} sourcePath
 * @param {string} [sheetName]
 * @param {string} [excelTableName]
 * @param {number} [maxSampleRows]
 */
async function readExcelSource(sourceType, sourcePath, sheetName, excelTableName, maxSampleRows = 200) {
  const buf = await loadWorkbookBuffer(sourceType, sourcePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const sheetNames = wb.worksheets.map((w) => w.name).filter(Boolean);

  const ws =
    sheetName && String(sheetName).trim()
      ? wb.getWorksheet(String(sheetName).trim())
      : wb.worksheets[0];

  if (!ws) {
    const e = new Error(sheetName ? `Sheet not found: ${sheetName}` : "Workbook has no worksheets");
    e.code = "NO_SHEET";
    throw e;
  }

  /** @type {string[]} */
  const tableNames = [];
  try {
    for (const t of ws.getTables()) {
      if (t && t.table && t.table.name) tableNames.push(String(t.table.name));
    }
  } catch {
    /* ignore */
  }

  let bounds = null;
  if (excelTableName && String(excelTableName).trim()) {
    const tn = String(excelTableName).trim();
    const tbl = ws.getTable(tn);
    if (!tbl || !tbl.table || !tbl.table.ref) {
      const e = new Error(`Excel table not found on sheet: ${tn}`);
      e.code = "NO_TABLE";
      throw e;
    }
    bounds = parseRangeRef(tbl.table.ref);
  } else {
    bounds = sheetAutoBounds(ws);
  }

  if (!bounds) {
    const e = new Error("Could not detect used range in sheet");
    e.code = "EMPTY_SHEET";
    throw e;
  }

  const { columns, rows } = readRectAsObjects(ws, bounds, maxSampleRows);
  return {
    sheetNames,
    tableNames: [...new Set(tableNames)],
    columns,
    sampleRows: rows,
    rowCountSample: rows.length
  };
}

/**
 * Infer coarse types from sample values (for preview UI).
 * @param {string[]} columns
 * @param {Record<string, unknown>[]} rows
 */
function inferColumnTypes(columns, rows) {
  /** @type {Record<string, string>} */
  const out = {};
  const sample = (rows || []).slice(0, 250);
  for (const col of columns || []) {
    let nNum = 0;
    let nDate = 0;
    let nBool = 0;
    let nStr = 0;
    let nEmpty = 0;
    for (const row of sample) {
      const v = row[col];
      if (v == null || v === "") {
        nEmpty++;
        continue;
      }
      if (typeof v === "boolean") nBool++;
      else if (typeof v === "number" && Number.isFinite(v)) nNum++;
      else if (v instanceof Date) nDate++;
      else {
        const s = String(v).trim();
        if (s === "true" || s === "false" || s === "TRUE" || s === "FALSE") nBool++;
        else if (/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ""))) nNum++;
        else if (!Number.isNaN(Date.parse(s)) && /\d{4}|\d{1,2}\/\d/.test(s)) nDate++;
        else nStr++;
      }
    }
    const nonEmpty = sample.length - nEmpty || 1;
    if (nBool >= nonEmpty * 0.6) out[col] = "boolean";
    else if (nNum >= nonEmpty * 0.5) out[col] = "number";
    else if (nDate >= nonEmpty * 0.35) out[col] = "date";
    else out[col] = "string";
  }
  return out;
}

/**
 * Load all worksheets (bounded rows per sheet). First sheet is the default preview.
 * @param {string} sourceType
 * @param {string} sourcePath
 * @param {number} [maxRowsPerSheet] omit or 0 to use server default (all rows up to hard cap)
 */
async function readExcelWorkbookPreview(sourceType, sourcePath, maxRowsPerSheet) {
  const hardCap = Math.min(
    2_000_000,
    Math.max(1000, Number(process.env.DATAFLOW_PREVIEW_MAX_ROWS_PER_SHEET_CAP) || 500_000)
  );
  const requested = Number(maxRowsPerSheet);
  const cap = Math.min(
    hardCap,
    Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : hardCap)
  );
  const buf = await loadWorkbookBuffer(sourceType, sourcePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const sheetNames = wb.worksheets.map((w) => w.name).filter(Boolean);
  if (!sheetNames.length) {
    const e = new Error("Workbook has no worksheets");
    e.code = "NO_SHEET";
    throw e;
  }

  /** @type {Record<string, { columns: string[], rows: Record<string, unknown>[], rowCount: number }>} */
  const sheets = {};
  for (const name of sheetNames) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const bounds = sheetAutoBounds(ws);
    if (!bounds) {
      sheets[name] = { columns: [], rows: [], rowCount: 0 };
      continue;
    }
    const { columns, rows } = readRectAsObjects(ws, bounds, cap);
    sheets[name] = { columns, rows, rowCount: rows.length };
  }

  const defaultSheet = sheetNames[0];
  const def = sheets[defaultSheet] || { columns: [], rows: [], rowCount: 0 };
  const columnTypes = inferColumnTypes(def.columns, def.rows);

  return {
    sheetNames,
    defaultSheet,
    defaultPreview: {
      columns: def.columns,
      rows: def.rows,
      columnTypes,
      rowCount: def.rowCount
    },
    sheets,
    columns: def.columns,
    sampleRows: def.rows,
    rowCountSample: def.rowCount,
    tableNames: []
  };
}

module.exports = {
  readExcelSource,
  readExcelWorkbookPreview,
  loadWorkbookBuffer,
  assertAllowedLocalPath,
  assertHttpUrl
};
