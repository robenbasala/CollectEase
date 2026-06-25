"use strict";

const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Parse numbers from Dataverse formatted strings ($1,234.00) and plain values. */
function parseNumericValue(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return null;
  let s = String(raw).trim();
  if (!s) return null;
  const paren = /^\((.+)\)$/.exec(s);
  if (paren) s = `-${paren[1].trim()}`;
  s = s.replace(/[,$\s\u00a0€£¥]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Unwrap OData Money/Decimal objects ({ Value: 100 } — capital V from Dataverse). */
function extractODataPrimitive(v) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return v;
  const t = String(v["@odata.type"] || "").toLowerCase();
  if (
    t.includes("money") ||
    t.includes("decimal") ||
    t.includes("double") ||
    t.includes("integer") ||
    t.includes("int32") ||
    t.includes("int64")
  ) {
    const n = v.Value ?? v.value;
    if (n !== undefined && n !== null) return n;
  }
  if (typeof v.Value === "number" || typeof v.Value === "string") return v.Value;
  if (typeof v.value === "number" || typeof v.value === "string") return v.value;
  if ("@odata.type" in v) return v.Label ?? v.value ?? v.Value ?? null;
  return v;
}

/**
 * @param {unknown} raw
 * @param {string[]} transforms
 * @param {{ dataType: string, maxLength: number|null }} destCol
 * @returns {{ value: unknown, warnings: string[] }}
 */
function applyTransforms(raw, transforms, destCol) {
  const warnings = [];
  const ops = new Set((transforms || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  let v = raw;

  if (v === undefined || v === null) return { value: null, warnings };

  if (ops.has("trim") || typeof v === "string") {
    if (typeof v === "string") v = v.trim();
  }

  if (ops.has("cleaninvalidchars") && typeof v === "string") {
    v = v.replace(CTRL, "");
  }

  const dt = String(destCol?.dataType || "").toLowerCase();

  if (ops.has("convertboolean") || dt === "bit") {
    const b = toBoolean(v);
    return { value: b, warnings };
  }

  if (ops.has("convertnumber") || dt.includes("decimal") || dt.includes("money") || dt.includes("int") || dt === "float" || dt === "real") {
    if (v === "" || v === null) return { value: null, warnings };
    const n = parseNumericValue(extractODataPrimitive(v));
    return { value: n, warnings };
  }

  if (ops.has("convertdate") || dt.includes("date") || dt.includes("time")) {
    if (v === "" || v === null) return { value: null, warnings };
    const d = new Date(v);
    return { value: Number.isNaN(d.getTime()) ? null : d, warnings };
  }

  if (typeof v === "string" && ops.has("maxlengthtruncate")) {
    const max =
      destCol?.maxLength != null && destCol.maxLength > 0 && destCol.maxLength < 4000
        ? destCol.maxLength
        : 4000;
    if (v.length > max) {
      warnings.push(`Truncated to ${max} characters`);
      v = v.slice(0, max);
    }
  }

  if (v === "") {
    if (
      dt.includes("date") ||
      dt.includes("time") ||
      dt === "bit" ||
      dt.includes("int") ||
      dt.includes("decimal") ||
      dt === "float" ||
      dt === "real"
    ) {
      return { value: null, warnings };
    }
  }

  return { value: v, warnings };
}

function toBoolean(v) {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return null;
}

function typeCompatibilityWarning(sourceType, destDataType) {
  const s = String(sourceType || "").toLowerCase();
  const d = String(destDataType || "").toLowerCase();
  if (!s || !d) return null;
  if (s === "string" && (d.includes("int") || d.includes("decimal") || d === "bit")) {
    return "Source is text; destination is numeric/boolean — values may become null if conversion fails.";
  }
  if ((s === "integer" || s === "number") && d.includes("date")) {
    return "Source is numeric; destination is date — use Convert date transform.";
  }
  return null;
}

module.exports = {
  applyTransforms,
  typeCompatibilityWarning,
  toBoolean,
  parseNumericValue,
  extractODataPrimitive
};
