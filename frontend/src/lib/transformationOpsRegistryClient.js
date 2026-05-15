/**
 * Browser/Vite ESM copy of the transformation registry.
 * Node source of truth: shared/transformationOpsRegistry.cjs
 * Regenerate: node backend/scripts/sync-transformation-registry-client.js
 */

/**
 * Single source of truth for CollectEase JSON transformation pipeline (v1).
 * Used by backend validation and frontend step builder / client-side checks.
 * This is not Microsoft Power Query M.
 */

/** @typedef {{ stepIndex: number, op: string, problem: string, suggestion?: string, severity?: 'error'|'warning' }} PipelineDiag */

const TRANSFORMATION_OPS = {
  comment: {
    op: "comment",
    label: "Comment (no-op)",
    description: "Ignored by the engine — use for notes inside the JSON.",
    affects: "none",
    fields: [],
    example: { op: "comment", note: "Optional keys are ignored" }
  },
  useSheet: {
    op: "useSheet",
    label: "Use worksheet",
    description: "Replace the working rows with all rows from the named Excel sheet.",
    affects: "sheets",
    fields: [{ name: "sheet", type: "string", required: true }],
    example: { op: "useSheet", sheet: "Sheet1" }
  },
  appendSheet: {
    op: "appendSheet",
    label: "Append worksheet",
    description: "Append all rows from another sheet to the current working table.",
    affects: "sheets",
    fields: [{ name: "sheet", type: "string", required: true }],
    example: { op: "appendSheet", sheet: "Archive" }
  },
  select: {
    op: "select",
    label: "Select columns",
    description: "Keep only the listed columns (in order). Missing columns become undefined.",
    affects: "columns",
    fields: [{ name: "columns", type: "array", required: true, itemType: "string" }],
    example: { op: "select", columns: ["Unit", "Balance"] }
  },
  rename: {
    op: "rename",
    label: "Rename columns",
    description: "Renames keys on every row. The engine field is `map` (object from old name → new name). The alias `columns` is accepted for backward compatibility.",
    affects: "columns",
    fields: [
      {
        name: "map",
        type: "object",
        required: true,
        altNames: ["columns"],
        note: "Use `map` (preferred). `columns` works as an alias."
      }
    ],
    example: {
      op: "rename",
      map: { "Old Name": "NewName" }
    }
  },
  removeColumns: {
    op: "removeColumns",
    label: "Remove columns",
    description: "Deletes listed column keys from every row. Same as `drop`.",
    affects: "columns",
    fields: [{ name: "columns", type: "array", required: true, itemType: "string" }],
    aliases: ["drop"],
    example: { op: "removeColumns", columns: ["Unused"] }
  },
  trimAll: {
    op: "trimAll",
    label: "Trim all text",
    description: "Trims leading/trailing spaces on every string cell.",
    affects: "rows",
    fields: [],
    example: { op: "trimAll" }
  },
  trimColumn: {
    op: "trimColumn",
    label: "Trim one column",
    description: "Trims one string column if present.",
    affects: "rows",
    fields: [{ name: "column", type: "string", required: true }],
    example: { op: "trimColumn", column: "Name" }
  },
  cleanTextColumn: {
    op: "cleanTextColumn",
    label: "Clean text column",
    description: "Normalizes spaces (including NBSP) in one column.",
    affects: "rows",
    fields: [{ name: "column", type: "string", required: true }],
    example: { op: "cleanTextColumn", column: "Notes" }
  },
  upperColumn: {
    op: "upperColumn",
    label: "Uppercase column",
    affects: "rows",
    fields: [{ name: "column", type: "string", required: true }],
    example: { op: "upperColumn", column: "Code" }
  },
  lowerColumn: {
    op: "lowerColumn",
    label: "Lowercase column",
    affects: "rows",
    fields: [{ name: "column", type: "string", required: true }],
    example: { op: "lowerColumn", column: "email" }
  },
  replaceValues: {
    op: "replaceValues",
    label: "Replace text in column",
    description: "String replace in one column (empty `from` leaves value unchanged).",
    affects: "rows",
    fields: [
      { name: "column", type: "string", required: true },
      { name: "from", type: "string", required: false },
      { name: "to", type: "string", required: false }
    ],
    example: { op: "replaceValues", column: "Phone", from: "(", to: "" }
  },
  addConstant: {
    op: "addConstant",
    label: "Add constant column",
    affects: "columns",
    fields: [
      { name: "name", type: "string", required: true },
      { name: "value", type: "any", required: false }
    ],
    example: { op: "addConstant", name: "Source", value: "Excel" }
  },
  filter: {
    op: "filter",
    label: "Filter rows (simple)",
    description: "Filter by one column: notBlank, blank, eq, or ne (requires `value` for eq/ne).",
    affects: "rows",
    fields: [
      { name: "column", type: "string", required: true },
      { name: "where", type: "string", required: false },
      { name: "value", type: "any", required: false }
    ],
    example: { op: "filter", column: "Unit", where: "notBlank" }
  },
  coerceTypes: {
    op: "coerceTypes",
    label: "Coerce types",
    description: "Per-column coercion: number, int, float, decimal, date, datetime, string.",
    affects: "rows",
    fields: [{ name: "map", type: "object", required: true }],
    example: { op: "coerceTypes", map: { Balance: "number" } }
  },
  filterExpr: {
    op: "filterExpr",
    label: "Filter rows (expression)",
    description:
      "Keeps rows where the expression is truthy. Use `and`, `or`, `not` — not && || !. Field must be `expression` (alias `expr` is normalized on the server).",
    affects: "rows",
    fields: [{ name: "expression", type: "string", required: true, altNames: ["expr"] }],
    example: { op: "filterExpr", expression: "not IsBlank(Unit) and Unit != 'Unit'" }
  },
  addExprColumn: {
    op: "addExprColumn",
    label: "Add expression column",
    description: "Adds or overwrites a column from a row expression. Requires `name` and `expression`.",
    affects: "columns",
    fields: [
      { name: "name", type: "string", required: true },
      { name: "expression", type: "string", required: true, altNames: ["expr"] }
    ],
    example: { op: "addExprColumn", name: "RentGap", expression: "Value(Market_Rent) - Value(Actual_Rent)" }
  },
  removeTopRows: {
    op: "removeTopRows",
    label: "Remove top rows",
    description: "Drops the first N rows from the current table (use before promoteHeaders to skip title rows).",
    affects: "rows",
    fields: [{ name: "count", type: "number", required: true }],
    example: { op: "removeTopRows", count: 2 }
  },
  promoteHeaders: {
    op: "promoteHeaders",
    label: "Use first row as headers",
    description: "Uses the first remaining row’s cell values as new column names, then removes that row. Blank headers become Column_1, Column_2, …; duplicates get __2, __3 suffixes.",
    affects: "columns",
    fields: [],
    example: { op: "promoteHeaders" }
  },
  removeEmptyRows: {
    op: "removeEmptyRows",
    label: "Remove empty rows",
    description: "Removes rows where every column is blank.",
    affects: "rows",
    fields: [],
    example: { op: "removeEmptyRows" }
  },
  removeEmptyColumns: {
    op: "removeEmptyColumns",
    label: "Remove empty columns",
    description: "Removes columns where every row is blank.",
    affects: "columns",
    fields: [],
    example: { op: "removeEmptyColumns" }
  },
  cleanText: {
    op: "cleanText",
    label: "Clean all text",
    description: "Trims and normalizes whitespace on every string cell (all columns).",
    affects: "rows",
    fields: [],
    example: { op: "cleanText" }
  },
  filterRows: {
    op: "filterRows",
    label: "Filter rows",
    description: "Filter by column with operators: notEmpty, empty, equals, contains, greaterThan, etc.",
    affects: "rows",
    fields: [{ name: "where", type: "object", required: true }],
    example: { op: "filterRows", where: { column: "Unit", operator: "notEmpty" } }
  },
  normalizeDate: {
    op: "normalizeDate",
    label: "Normalize dates",
    description: "Parse date columns to ISO date strings (YYYY-MM-DD).",
    affects: "rows",
    fields: [{ name: "columns", type: "array", required: true, itemType: "string" }],
    example: { op: "normalizeDate", columns: ["DOB"] }
  },
  normalizeMoney: {
    op: "normalizeMoney",
    label: "Normalize money",
    description: "Strip $ and commas; handle (1,200) as negative numbers.",
    affects: "rows",
    fields: [{ name: "columns", type: "array", required: true, itemType: "string" }],
    example: { op: "normalizeMoney", columns: ["Balance"] }
  },
  deduplicate: {
    op: "deduplicate",
    label: "Deduplicate rows",
    description: "Keep first or last row per key columns.",
    affects: "rows",
    fields: [
      { name: "columns", type: "array", required: true, itemType: "string" },
      { name: "keep", type: "string", required: false }
    ],
    example: { op: "deduplicate", columns: ["uniqueid"], keep: "first" }
  }
};

const EXPR_HELPER_FUNCTIONS = [
  { name: "And", signature: "And(a, b, ...)", description: "True if every argument is truthy." },
  { name: "Or", signature: "Or(a, b, ...)", description: "True if any argument is truthy." },
  { name: "Not", signature: "Not(x)", description: "Logical not." },
  { name: "Blank", signature: "Blank()", description: "Null / blank sentinel." },
  { name: "IsBlank", signature: "IsBlank(value)", description: "True for null, empty, or whitespace-only string." },
  { name: "If", signature: "If(cond, a, b)", description: "Conditional." },
  { name: "Len", signature: "Len(text)", description: "String length." },
  { name: "Left", signature: "Left(text, count)", description: "First count characters." },
  { name: "Text", signature: "Text(value)", description: "Coerce to string." },
  { name: "Value", signature: "Value(text)", description: "Parse number (strips commas)." }
];

const SUPPORTED_OP_LIST = Object.keys(TRANSFORMATION_OPS);

/** Map alternate op / type names to engine op keys. */
const OP_NAME_ALIASES = {
  drop: "removeColumns",
  skipRows: "removeTopRows",
  renameColumns: "rename",
  keepColumns: "select",
  replaceValue: "replaceValues",
  convertTypes: "coerceTypes",
  addCalculatedColumn: "addExprColumn",
  filterRows: "filterRows"
};

function canonicalOpName(op) {
  const s = String(op || "").trim();
  return OP_NAME_ALIASES[s] || s;
}

function opMeta(op) {
  const c = canonicalOpName(op);
  const meta = TRANSFORMATION_OPS[c];
  if (!meta) return null;
  if (c === "removeColumns" && meta.aliases && meta.aliases.includes(op)) return meta;
  return meta;
}

/**
 * Normalize step fields for engine execution (aliases, legacy op names).
 * @param {object} step
 * @returns {object}
 */
function normalizeStep(step) {
  if (!step || typeof step !== "object") return step;
  let op = String(step.op || step.type || "").trim();
  op = canonicalOpName(op);
  if (op === "skipRows") op = "removeTopRows";
  if (op === "drop") op = "removeColumns";
  const out = { ...step, op };
  delete out.type;
  if (op === "rename") {
    if ((!out.map || typeof out.map !== "object") && out.columns && typeof out.columns === "object") {
      out.map = out.columns;
      delete out.columns;
    }
  }
  if (op === "filterExpr" || op === "addExprColumn") {
    const ex = String(out.expression || "").trim();
    if (!ex && out.expr != null) {
      out.expression = String(out.expr);
      delete out.expr;
    }
  }
  if (op === "removeTopRows") {
    if (out.count === undefined && out.rows !== undefined) out.count = out.rows;
  }
  return out;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

function fieldPresent(step, field) {
  const names = [field.name, ...(field.altNames || [])];
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(step, n) && step[n] !== undefined && step[n] !== null) {
      if (field.type === "string" && typeof step[n] === "string" && step[n].trim() === "") continue;
      return { key: n, value: step[n] };
    }
  }
  return null;
}

/**
 * @param {object} obj parsed pipeline { version, steps }
 * @param {{ sheetNames?: string[] }} [ctx]
 * @returns {{ errors: PipelineDiag[], warnings: PipelineDiag[] }}
 */
function validateParsedPipeline(obj, ctx = {}) {
  /** @type {PipelineDiag[]} */
  const errors = [];
  /** @type {PipelineDiag[]} */
  const warnings = [];

  if (!obj || typeof obj !== "object") {
    errors.push({
      stepIndex: 0,
      op: "",
      problem: "Pipeline must be a JSON object.",
      suggestion: 'Use a root object like { "version": 1, "steps": [] }.'
    });
    return { errors, warnings };
  }

  if (obj.version === undefined || obj.version === null) {
    warnings.push({
      stepIndex: 0,
      op: "",
      problem: 'Missing "version".',
      suggestion: 'Add "version": 1 at the root for clarity.',
      severity: "warning"
    });
  } else if (Number(obj.version) !== 1) {
    errors.push({
      stepIndex: 0,
      op: "",
      problem: `Unsupported pipeline version: ${JSON.stringify(obj.version)}.`,
      suggestion: 'Only version 1 is supported. Set "version": 1.'
    });
  }

  if (!Array.isArray(obj.steps)) {
    errors.push({
      stepIndex: 0,
      op: "",
      problem: 'Missing or invalid "steps" — must be an array.',
      suggestion: 'Add "steps": [ { "op": "trimAll" } ].'
    });
    return { errors, warnings };
  }

  const sheetNames = Array.isArray(ctx.sheetNames) ? ctx.sheetNames.map(String) : null;

  obj.steps.forEach((step, idx) => {
    const stepNum = idx + 1;
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      errors.push({
        stepIndex: stepNum,
        op: "",
        problem: `Step ${stepNum} must be a JSON object.`,
        suggestion: 'Example: { "op": "trimAll" }'
      });
      return;
    }

    const rawOp = String(step.op || "").trim();
    if (!rawOp) {
      errors.push({
        stepIndex: stepNum,
        op: "",
        problem: `Step ${stepNum} is missing "op".`,
        suggestion: 'Every step needs an "op" field, e.g. "trimAll" or "filterExpr".'
      });
      return;
    }

    const canon = canonicalOpName(rawOp);
    const meta = TRANSFORMATION_OPS[canon];
    if (!meta) {
      const hint =
        rawOp.toLowerCase().includes("skip") || rawOp.toLowerCase().includes("top")
          ? ' For skipping rows, use "removeTopRows" with a numeric "count".'
          : "";
      errors.push({
        stepIndex: stepNum,
        op: rawOp,
        problem: `"${rawOp}" is not supported by the CollectEase transformation engine.`,
        suggestion: `Supported operations: ${SUPPORTED_OP_LIST.join(", ")}.${hint}`
      });
      return;
    }

    if (rawOp === "drop") {
      warnings.push({
        stepIndex: stepNum,
        op: rawOp,
        problem: 'Op name "drop" works but is an alias.',
        suggestion: 'Prefer "removeColumns" for clarity.',
        severity: "warning"
      });
    }
    if (rawOp === "skipRows") {
      warnings.push({
        stepIndex: stepNum,
        op: rawOp,
        problem: '"skipRows" is treated as "removeTopRows".',
        suggestion: 'Prefer { "op": "removeTopRows", "count": <number> } in saved JSON.',
        severity: "warning"
      });
    }

    const normalized = normalizeStep({ ...step });

    if (canon === "rename" && step.columns && typeof step.columns === "object" && !step.map) {
      warnings.push({
        stepIndex: stepNum,
        op: canon,
        problem: "rename uses the field `map` (object). You used `columns`, which is accepted as an alias.",
        suggestion: 'Prefer { "op": "rename", "map": { "Old": "New" } } for documentation consistency.',
        severity: "warning"
      });
    }

    for (const field of meta.fields) {
      const pres = fieldPresent(normalized, field);
      if (field.required && !pres) {
        const suggestion = meta.example ? `Example:\n${JSON.stringify(meta.example, null, 2)}` : "";
        errors.push({
          stepIndex: stepNum,
          op: canon,
          problem: `Missing required field \`${field.name}\` for "${canon}".`,
          suggestion: suggestion || `Add "${field.name}" per operation docs.`
        });
        continue;
      }
      if (!pres) continue;

      if (field.type === "string" && typeof pres.value !== "string") {
        errors.push({
          stepIndex: stepNum,
          op: canon,
          problem: `Field \`${pres.key}\` must be a string for "${canon}".`,
          suggestion: JSON.stringify(meta.example, null, 2)
        });
      }
      if (field.type === "number") {
        const n = Number(pres.value);
        if (!Number.isFinite(n)) {
          errors.push({
            stepIndex: stepNum,
            op: canon,
            problem: `Field \`${pres.key}\` must be a finite number.`,
            suggestion: JSON.stringify(meta.example, null, 2)
          });
        }
        if (canon === "removeTopRows" && n < 0) {
          errors.push({
            stepIndex: stepNum,
            op: canon,
            problem: `"count" cannot be negative.`,
            suggestion: '{ "op": "removeTopRows", "count": 0 }'
          });
        }
      }
      if (field.type === "array") {
        if (!Array.isArray(pres.value)) {
          errors.push({
            stepIndex: stepNum,
            op: canon,
            problem: `Field \`${field.name}\` must be an array.`,
            suggestion: JSON.stringify(meta.example, null, 2)
          });
        } else if (field.itemType === "string" && pres.value.some((x) => typeof x !== "string")) {
          errors.push({
            stepIndex: stepNum,
            op: canon,
            problem: `Every entry in \`${field.name}\` must be a string.`,
            suggestion: JSON.stringify(meta.example, null, 2)
          });
        }
      }
      if (field.type === "object" && (typeof pres.value !== "object" || pres.value === null || Array.isArray(pres.value))) {
        errors.push({
          stepIndex: stepNum,
          op: canon,
          problem: `Field \`${pres.key}\` must be a JSON object.`,
          suggestion: JSON.stringify(meta.example, null, 2)
        });
      }
    }

    if ((canon === "useSheet" || canon === "appendSheet") && sheetNames && sheetNames.length) {
      const sn = String(normalized.sheet || "").trim();
      if (sn && !sheetNames.includes(sn)) {
        warnings.push({
          stepIndex: stepNum,
          op: canon,
          problem: `Sheet "${sn}" was not found in the loaded workbook preview.`,
          suggestion: `Available sheets: ${sheetNames.join(", ")}.`,
          severity: "warning"
        });
      }
    }

    if (canon === "filterExpr" || canon === "addExprColumn") {
      if (Object.prototype.hasOwnProperty.call(step, "expr") && !Object.prototype.hasOwnProperty.call(step, "expression")) {
        warnings.push({
          stepIndex: stepNum,
          op: canon,
          problem: "The canonical field name is `expression` (not `expr`).",
          suggestion: "The server accepts `expr` as an alias; prefer renaming to `expression` in saved JSON.",
          severity: "warning"
        });
      }
      if (step.expr != null && step.expression != null && String(step.expr) !== String(step.expression)) {
        warnings.push({
          stepIndex: stepNum,
          op: canon,
          problem: "Both `expr` and `expression` are set with different values.",
          suggestion: "Remove `expr` and keep only `expression`.",
          severity: "warning"
        });
      }
    }
  });

  return { errors, warnings };
}

/**
 * @param {string} scriptText
 * @param {{ sheetNames?: string[] }} [ctx]
 */
function validatePipelineText(scriptText, ctx) {
  const raw = String(scriptText ?? "").trim();
  if (!raw) {
    return {
      ok: true,
      errors: [],
      warnings: [],
      pipeline: { version: 1, steps: [] }
    };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          stepIndex: 0,
          op: "",
          problem: `Invalid JSON: ${e.message}`,
          suggestion: "Fix JSON syntax (commas, quotes, brackets) or use Format in the editor."
        }
      ],
      warnings: [],
      pipeline: null
    };
  }
  const { errors, warnings } = validateParsedPipeline(obj, ctx);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    pipeline: obj
  };
}

function formatDiagList(diagnostics, title) {
  if (!diagnostics.length) return "";
  const lines = diagnostics.map((d) => {
    const head = d.stepIndex ? `Step ${d.stepIndex}${d.op ? ` (${d.op})` : ""}` : "Pipeline";
    return `${head}\n  Problem: ${d.problem}${d.suggestion ? `\n  Fix: ${d.suggestion}` : ""}`;
  });
  return `${title}\n${lines.join("\n\n")}`;
}

function summarizeValidation(errors, warnings) {
  const parts = [];
  if (errors.length) parts.push(formatDiagList(errors, "Errors:"));
  if (warnings.length) parts.push(formatDiagList(warnings, "Warnings:"));
  return parts.join("\n\n") || "";
}

/**
 * @param {string[]} previewColumns raw header names from default sheet preview
 */
function buildExprColumnHints(previewColumns, sampleRows) {
  const cols = Array.isArray(previewColumns) ? previewColumns : [];
  const rows = Array.isArray(sampleRows) ? sampleRows : [];
  const used = new Set();
  function sanitizeExprIdent(name) {
    let s = String(name || "").trim();
    if (!s) return "empty_key";
    s = s.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
    s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (!s) return "col";
    if (/^\d/.test(s)) s = `c_${s}`;
    return s;
  }
  return cols.map((raw, colIdx) => {
    let id = sanitizeExprIdent(raw);
    const base = id;
    let n = 2;
    while (used.has(id)) {
      id = `${base}__${n++}`;
    }
    used.add(id);
    let sample = "";
    for (let ri = 0; ri < Math.min(rows.length, 8); ri++) {
      const row = rows[ri];
      if (row && row[raw] != null && String(row[raw]).trim() !== "") {
        sample = String(row[raw]).trim();
        if (sample.length > 48) sample = `${sample.slice(0, 45)}…`;
        break;
      }
    }
    return { raw: String(raw ?? ""), id, sample };
  });
}

const COLLECTION_REPORT_DEFAULTS = [
  "Collection Report Standard",
  "Collection Report Standard_2",
  "Collection Report Standard_3",
  "Collection Report Standard_4",
  "Collection Report Standard_5",
  "Collection Report Standard_6",
  "Collection Report Standard_7"
];

const COLLECTION_REPORT_TARGETS = ["Unit", "TenantId", "TenantName", "MarketRent", "ActualRent", "Balance", "LastPaymentDate"];

/**
 * @param {string[]} previewColumns
 * @returns {object} pipeline object
 */
function buildCollectionReportCleanupPipeline(previewColumns) {
  void previewColumns;
  /** After removeTopRows(5) + promoteHeaders, headers match Yardi-style collection report row 6. */
  const renameMap = {
    Code: "TenantId",
    Name: "TenantName",
    Rent: "MarketRent",
    Rent__2: "ActualRent",
    Balance: "Balance",
    Lastpaymentdate: "LastPaymentDate",
    Lastpaymentamount: "LastPaymentAmount",
    Hmyperson: "Hmyperson",
    Office: "Office",
    Home: "Home",
    Mobile: "Mobile",
    Email: "Email",
    Expiration: "Expiration"
  };
  return {
    version: 1,
    steps: [
      { op: "removeTopRows", count: 5 },
      { op: "promoteHeaders" },
      { op: "trimAll" },
      { op: "rename", map: renameMap },
      {
        op: "filterExpr",
        expression: `not IsBlank(Unit) and Unit != 'Unit' and TenantId != 'Code' and TenantName != 'Name'`
      }
    ]
  };
}

function sanitizeExprIdentForExport(name) {
  let s = String(name || "").trim();
  if (!s) return "empty_key";
  s = s.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!s) return "col";
  if (/^\d/.test(s)) s = `c_${s}`;
  return s;
}

function buildBasicCleanupPipeline() {
  return { version: 1, steps: [{ op: "trimAll" }] };
}

/**
 * @param {string} columnRawName
 * @param {string} [ident] optional precomputed ident
 */
function buildRemoveBlankRowsPipeline(columnRawName, ident) {
  const id = ident || sanitizeExprIdentForExport(columnRawName || "Column");
  return {
    version: 1,
    steps: [{ op: "filterExpr", expression: `not IsBlank(${id})` }]
  };
}

function buildRemoveHeaderRowPipeline(columnRawName, headerText, ident) {
  const id = ident || sanitizeExprIdentForExport(columnRawName || "Column");
  const lit = JSON.stringify(String(headerText ?? "HeaderText"));
  return {
    version: 1,
    steps: [{ op: "filterExpr", expression: `${id} != ${lit}` }]
  };
}


export {
  TRANSFORMATION_OPS,
  EXPR_HELPER_FUNCTIONS,
  SUPPORTED_OP_LIST,
  canonicalOpName,
  normalizeStep,
  validateParsedPipeline,
  validatePipelineText,
  formatDiagList,
  summarizeValidation,
  buildExprColumnHints,
  buildCollectionReportCleanupPipeline,
  buildBasicCleanupPipeline,
  buildRemoveBlankRowsPipeline,
  buildRemoveHeaderRowPipeline,
  sanitizeExprIdentForExport
};
