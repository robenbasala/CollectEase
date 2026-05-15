/**
 * CollectEase TransformationEngine — JSON pipeline (v1).
 * Row expressions use expr-eval (Excel-like operators), plus helpers similar to Power Fx: And, Or, Not, Blank, IsBlank, If, Value, Text, Len, Left.
 * This is not the Microsoft Power Fx interpreter (that engine is .NET-only); it gives comparable row-level filter/transform patterns inside JSON steps.
 */

"use strict";

const path = require("path");
const { Parser } = require("expr-eval");
const {
  normalizeStep,
  validateParsedPipeline,
  summarizeValidation
} = require(path.join(__dirname, "../../../shared/transformationOpsRegistry.cjs"));

const exprParser = new Parser();
exprParser.functions.And = (...args) => args.length > 0 && args.every(Boolean);
exprParser.functions.Or = (...args) => args.some(Boolean);
exprParser.functions.Not = (x) => !x;
exprParser.functions.Blank = () => null;
exprParser.functions.IsBlank = (x) =>
  x == null || x === "" || (typeof x === "string" && x.trim() === "");
exprParser.functions.If = (cond, a, b) => (cond ? a : b);
exprParser.functions.Len = (x) => (x == null ? 0 : String(x).length);
exprParser.functions.Left = (x, n) => {
  const s = String(x ?? "");
  const m = Number(n);
  if (!Number.isFinite(m) || m <= 0) return "";
  return s.slice(0, Math.floor(m));
};
exprParser.functions.Text = (x) => (x == null ? "" : String(x));
exprParser.functions.Value = (x) => {
  if (x == null || x === "") return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const n = Number(String(x).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

function sanitizeExprIdent(name) {
  let s = String(name || "").trim();
  if (!s) return "empty_key";
  s = s.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!s) return "col";
  if (/^\d/.test(s)) s = `c_${s}`;
  return s;
}

/**
 * Each column becomes a variable (spaces → _). `Row` is the full row object.
 * @param {Record<string, unknown>} row
 */
function buildRowExprScope(row) {
  /** @type {Record<string, unknown>} */
  const scope = { Row: row };
  const used = new Set();
  for (const [k, v] of Object.entries(row)) {
    let id = sanitizeExprIdent(k);
    const base = id;
    let n = 2;
    while (used.has(id)) {
      id = `${base}__${n++}`;
    }
    used.add(id);
    scope[id] = v;
  }
  return scope;
}

function cloneRows(rows) {
  return (rows || []).map((r) => (r && typeof r === "object" ? { ...r } : {}));
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
      const parts = Array.isArray(val.richText) ? val.richText.map((x) => x.text).join("") : "";
      return parts;
    }
  }
  return String(val);
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {object} step
 * @param {{ sheets: Record<string, { rows: Record<string, unknown>[] }>|null }} ctx
 */
function applyStep(rows, step, ctx) {
  step = normalizeStep(step);
  const op = step && typeof step === "object" ? String(step.op || "").trim() : "";
  if (!op) throw new Error("Each step requires op");

  if (op === "useSheet") {
    const sn = String(step.sheet || "").trim();
    if (!ctx.sheets || !Object.prototype.hasOwnProperty.call(ctx.sheets, sn)) {
      throw new Error(
        `Unknown sheet "${sn}". Available: ${ctx.sheets ? Object.keys(ctx.sheets).join(", ") : "(none)"}`
      );
    }
    return cloneRows(ctx.sheets[sn].rows);
  }
  if (op === "appendSheet") {
    const sn = String(step.sheet || "").trim();
    if (!ctx.sheets || !Object.prototype.hasOwnProperty.call(ctx.sheets, sn)) {
      throw new Error(`Unknown sheet "${sn}" for appendSheet.`);
    }
    return rows.concat(cloneRows(ctx.sheets[sn].rows));
  }
  if (op === "comment") {
    return rows;
  }

  switch (op) {
    case "select": {
      const cols = Array.isArray(step.columns) ? step.columns.map((c) => String(c)) : [];
      return rows.map((row) => {
        const o = {};
        for (const c of cols) {
          o[c] = Object.prototype.hasOwnProperty.call(row, c) ? row[c] : undefined;
        }
        return o;
      });
    }
    case "rename": {
      const map =
        step.map && typeof step.map === "object"
          ? step.map
          : step.columns && typeof step.columns === "object"
            ? step.columns
            : {};
      return rows.map((row) => {
        const o = { ...row };
        for (const [from, to] of Object.entries(map)) {
          if (Object.prototype.hasOwnProperty.call(o, from)) {
            o[String(to)] = o[from];
            delete o[from];
          }
        }
        return o;
      });
    }
    case "removeColumns":
    case "drop": {
      const cols = new Set((Array.isArray(step.columns) ? step.columns : []).map((c) => String(c)));
      return rows.map((row) => {
        const o = { ...row };
        cols.forEach((c) => {
          delete o[c];
        });
        return o;
      });
    }
    case "trimAll":
      return rows.map((row) => {
        const o = {};
        for (const [k, v] of Object.entries(row)) {
          o[k] = v != null && typeof v === "string" ? v.trim() : v;
        }
        return o;
      });
    case "trimColumn": {
      const col = String(step.column || "");
      return rows.map((row) => {
        const o = { ...row };
        if (col && Object.prototype.hasOwnProperty.call(o, col) && typeof o[col] === "string") {
          o[col] = o[col].trim();
        }
        return o;
      });
    }
    case "cleanTextColumn": {
      const col = String(step.column || "");
      return rows.map((row) => {
        const o = { ...row };
        if (!col || !Object.prototype.hasOwnProperty.call(o, col)) return o;
        let s = cellText(o[col]);
        s = s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        o[col] = s;
        return o;
      });
    }
    case "upperColumn": {
      const col = String(step.column || "");
      return rows.map((row) => {
        const o = { ...row };
        if (col && typeof o[col] === "string") o[col] = o[col].toUpperCase();
        return o;
      });
    }
    case "lowerColumn": {
      const col = String(step.column || "");
      return rows.map((row) => {
        const o = { ...row };
        if (col && typeof o[col] === "string") o[col] = o[col].toLowerCase();
        return o;
      });
    }
    case "replaceValues": {
      const col = String(step.column || "");
      const from = step.from != null ? String(step.from) : "";
      const to = step.to != null ? String(step.to) : "";
      return rows.map((row) => {
        const o = { ...row };
        if (!col || !Object.prototype.hasOwnProperty.call(o, col)) return o;
        const s = cellText(o[col]);
        o[col] = from === "" ? s : s.split(from).join(to);
        return o;
      });
    }
    case "addConstant": {
      const name = String(step.name || "").trim();
      if (!name) throw new Error("addConstant requires name");
      const value = step.value;
      return rows.map((row) => ({ ...row, [name]: value }));
    }
    case "filter": {
      const col = String(step.column || "");
      const where = String(step.where || "notBlank");
      return rows.filter((row) => {
        const v = col ? row[col] : undefined;
        const t = v == null ? "" : String(v).trim();
        if (where === "notBlank") return t !== "";
        if (where === "blank") return t === "";
        if (where === "eq") return String(v ?? "") === String(step.value ?? "");
        if (where === "ne") return String(v ?? "") !== String(step.value ?? "");
        return true;
      });
    }
    case "coerceTypes": {
      const map = step.map && typeof step.map === "object" ? step.map : {};
      return rows.map((row) => {
        const o = { ...row };
        for (const [col, typ] of Object.entries(map)) {
          if (!Object.prototype.hasOwnProperty.call(o, col)) continue;
          const raw = o[col];
          if (raw == null || raw === "") continue;
          const t = String(typ).toLowerCase();
          try {
            if (t === "number" || t === "decimal" || t === "int" || t === "float") {
              const n = Number(String(cellText(raw)).replace(/,/g, "").trim());
              if (Number.isFinite(n)) o[col] = n;
            } else if (t === "date" || t === "datetime") {
              const d = new Date(cellText(raw));
              if (!Number.isNaN(d.getTime())) o[col] = d.toISOString();
            } else if (t === "string") {
              o[col] = cellText(raw);
            }
          } catch {
            /* keep original */
          }
        }
        return o;
      });
    }
    case "removeTopRows": {
      if (step.count === undefined || step.count === null) throw new Error("removeTopRows requires count");
      const n = Number(step.count);
      if (!Number.isFinite(n) || n < 0) throw new Error("removeTopRows requires a non-negative finite number for count");
      const k = Math.min(Math.floor(n), rows.length);
      return rows.slice(k);
    }
    case "promoteHeaders": {
      if (!rows.length) return rows;
      const headerRow = rows[0];
      const oldKeys = Object.keys(headerRow);
      const usedNames = new Set();
      /** @type {Record<string, string>} */
      const oldToNew = {};
      for (let i = 0; i < oldKeys.length; i++) {
        const oldKey = oldKeys[i];
        let label = cellText(headerRow[oldKey]).trim().replace(/\s+/g, " ");
        if (!label) label = `Column_${i + 1}`;
        let finalName = label;
        let d = 2;
        while (usedNames.has(finalName)) {
          finalName = `${label}__${d++}`;
        }
        usedNames.add(finalName);
        oldToNew[oldKey] = finalName;
      }
      return rows.slice(1).map((row) => {
        const o = {};
        for (const ok of oldKeys) {
          o[oldToNew[ok]] = row[ok];
        }
        return o;
      });
    }
    case "filterExpr": {
      const expression = String(step.expression ?? step.expr ?? "").trim();
      if (!expression) throw new Error("filterExpr requires expression");
      let compiled;
      try {
        compiled = exprParser.parse(expression);
      } catch (e) {
        throw new Error(`filterExpr: ${e.message}`);
      }
      return rows.filter((row) => {
        const scope = buildRowExprScope(row);
        try {
          return !!compiled.evaluate(scope);
        } catch (e) {
          throw new Error(`filterExpr: ${e.message}`);
        }
      });
    }
    case "addExprColumn": {
      const outName = String(step.name || "").trim();
      const expression = String(step.expression ?? step.expr ?? "").trim();
      if (!outName) throw new Error("addExprColumn requires name");
      if (!expression) throw new Error("addExprColumn requires expression");
      let compiled;
      try {
        compiled = exprParser.parse(expression);
      } catch (e) {
        throw new Error(`addExprColumn: ${e.message}`);
      }
      return rows.map((row) => {
        const scope = buildRowExprScope(row);
        let v;
        try {
          v = compiled.evaluate(scope);
        } catch (e) {
          throw new Error(`addExprColumn: ${e.message}`);
        }
        return { ...row, [outName]: v };
      });
    }
    default:
      throw new Error(`Unknown transformation op: ${op}`);
  }
}

function parsePipeline(scriptText) {
  const raw = String(scriptText ?? "").trim();
  if (!raw) return { version: 1, steps: [] };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const e = new Error(
      "Transformation script must be valid JSON (CollectEase pipeline). Supported ops include useSheet, appendSheet, rename, select, removeColumns, trimAll, filter, filterExpr, addExprColumn, removeTopRows, promoteHeaders, coerceTypes, addConstant, replaceValues, and more."
    );
    e.code = "PARSE";
    throw e;
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("Invalid pipeline: expected object");
  }
  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  return { version: Number(obj.version) || 1, steps };
}

/**
 * @param {string} scriptText
 * @param {Record<string, unknown>[]} rows starting rows (usually first sheet)
 * @param {{ sheets?: Record<string, { rows: Record<string, unknown>[] }>|null }} [options]
 */
function runTransformationEngine(scriptText, rows, options = {}) {
  let pipeline;
  try {
    pipeline = parsePipeline(scriptText);
  } catch (e) {
    return {
      ok: false,
      error: e.message || "Invalid pipeline",
      validationErrors: [],
      warnings: [],
      rows: [],
      columns: []
    };
  }
  const sheetNames = options.sheetNames && Array.isArray(options.sheetNames) ? options.sheetNames : null;
  const vctx = sheetNames ? { sheetNames } : {};
  const { errors: validationErrors, warnings } = validateParsedPipeline(pipeline, vctx);
  if (validationErrors.length) {
    return {
      ok: false,
      error: summarizeValidation(validationErrors, warnings),
      validationErrors,
      warnings,
      rows: [],
      columns: []
    };
  }
  const ctx = { sheets: options.sheets && typeof options.sheets === "object" ? options.sheets : null };
  let out = cloneRows(rows);
  try {
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      out = applyStep(out, step, ctx);
    }
  } catch (e) {
    let failedIdx = 1;
    let rawOp = "";
    let msg = e.message || "Transform failed";
    let partial = cloneRows(rows);
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      rawOp = step && typeof step === "object" ? String(step.op || "").trim() : "";
      try {
        partial = applyStep(partial, step, ctx);
      } catch (inner) {
        failedIdx = i + 1;
        msg = inner.message || msg;
        break;
      }
    }
    return {
      ok: false,
      error: `Step ${failedIdx}${rawOp ? ` (${rawOp})` : ""}: ${msg}`,
      validationErrors: [
        {
          stepIndex: failedIdx,
          op: rawOp,
          problem: msg,
          suggestion: "Check field values and expression syntax (use `and` / `or` / `not`, not && ||)."
        }
      ],
      warnings,
      rows: [],
      columns: []
    };
  }
  const colSet = new Set();
  out.forEach((r) => {
    Object.keys(r).forEach((k) => colSet.add(k));
  });
  return { ok: true, error: null, validationErrors: [], warnings, rows: out, columns: [...colSet] };
}

module.exports = {
  runTransformationEngine,
  parsePipeline
};
