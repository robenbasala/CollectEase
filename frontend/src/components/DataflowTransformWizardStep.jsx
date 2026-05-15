import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clipboard,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2
} from "lucide-react";
import {
  TRANSFORMATION_OPS,
  EXPR_HELPER_FUNCTIONS,
  SUPPORTED_OP_LIST,
  buildExprColumnHints,
  buildCollectionReportCleanupPipeline,
  buildBasicCleanupPipeline,
  buildRemoveBlankRowsPipeline,
  buildRemoveHeaderRowPipeline
} from "@collectease/transformation-ops";
import DataflowTransformToolbar from "./DataflowTransformToolbar.jsx";
import DataflowStepList from "./DataflowStepList.jsx";
import { parsePipelineText, appendStep, stringifyPipeline } from "../lib/dataflowPipelineUtils.js";

const TEMPLATE_OPTIONS = [
  { id: "basic", label: "Basic cleanup (trim all)" },
  { id: "collection", label: "Collection report: trim + rename first columns + filter header rows" },
  { id: "blank", label: "Remove rows where first column is blank" },
  { id: "header", label: "Remove rows matching header text (first column)" }
];

function parsePipelineSafe(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { version: 1, steps: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function opChoices() {
  return SUPPORTED_OP_LIST.map((op) => {
    const m = TRANSFORMATION_OPS[op];
    return { op, label: m?.label || op };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export default function DataflowTransformWizardStep({
  transformationScript,
  onTransformationScriptChange,
  workbook,
  transformErr,
  transformOk,
  transformOutput,
  transformPreviewBusy,
  transformWarnings = [],
  clientValidation,
  serverValidationErrors = [],
  onRunPreview,
  onValidateOnly,
  onAddStep,
  onPipelineChange,
  busy,
  defaultPipelineText
}) {
  const [addOp, setAddOp] = useState("trimAll");
  const [addForm, setAddForm] = useState({});
  const [templateId, setTemplateId] = useState("");
  const [headerFilterText, setHeaderFilterText] = useState("Unit");
  const [stepBuilderErr, setStepBuilderErr] = useState("");

  const mergeAddForm = useCallback((patch) => {
    setAddForm((f) => ({ ...f, ...patch }));
  }, []);

  const sheetNames = workbook?.sheetNames || [];
  const previewCols = workbook?.defaultPreview?.columns || [];
  const previewRows = workbook?.defaultPreview?.rows || [];

  const columnHints = useMemo(
    () => buildExprColumnHints(previewCols, previewRows),
    [previewCols, previewRows]
  );

  const selectedMeta = TRANSFORMATION_OPS[addOp] || null;

  const resetAddForm = useCallback((op) => {
    if (op === "rename") {
      setAddForm({ renamePairs: [{ from: "", to: "" }] });
      return;
    }
    const m = TRANSFORMATION_OPS[op];
    if (!m?.example) {
      setAddForm({});
      return;
    }
    const ex = { ...m.example };
    delete ex.op;
    setAddForm(ex);
  }, []);

  const onPickOp = (op) => {
    setAddOp(op);
    resetAddForm(op);
    setStepBuilderErr("");
  };

  const handleQuickAddStep = useCallback(
    (step) => {
      if (onAddStep) {
        onAddStep(step);
        return;
      }
      onTransformationScriptChange((prev) => {
        const base = parsePipelineText(prev) || { version: 1, steps: [] };
        return stringifyPipeline(appendStep(base, step));
      });
    },
    [onAddStep, onTransformationScriptChange]
  );

  const handlePipelineChange = useCallback(
    (text) => {
      if (onPipelineChange) {
        onPipelineChange(text);
        return;
      }
      onTransformationScriptChange(text);
    },
    [onPipelineChange, onTransformationScriptChange]
  );

  useEffect(() => {
    if (addOp === "useSheet" || addOp === "appendSheet") {
      setAddForm((f) => ({ ...f, sheet: f.sheet || sheetNames[0] || "" }));
    }
  }, [addOp, sheetNames]);

  const appendStep = useCallback(() => {
    setStepBuilderErr("");
    const meta = TRANSFORMATION_OPS[addOp];
    if (!meta) return;
    /** @type {Record<string, unknown>} */
    let step = { op: addOp };

    if (addOp === "rename") {
      const o = {};
      for (const p of addForm.renamePairs || []) {
        if (p?.from && String(p.to || "").trim()) o[String(p.from)] = String(p.to).trim();
      }
      if (!Object.keys(o).length) {
        setStepBuilderErr("Add at least one rename (source column and new name).");
        return;
      }
      step = { op: "rename", map: o };
    } else if (addOp === "useSheet" || addOp === "appendSheet") {
      const sn = String(addForm.sheet || "").trim();
      if (!sn) {
        setStepBuilderErr("Select a sheet name.");
        return;
      }
      step = { op: addOp, sheet: sn };
    } else if (addOp === "removeTopRows") {
      const n = Number(addForm.count);
      if (!Number.isFinite(n) || n < 0) {
        setStepBuilderErr("Enter a non-negative number for rows to remove.");
        return;
      }
      step = { op: "removeTopRows", count: Math.floor(n) };
    } else if (addOp === "select" || addOp === "removeColumns") {
      const cols = Array.isArray(addForm.columns) ? addForm.columns : [];
      if (!cols.length) {
        setStepBuilderErr("Enter at least one column name (comma-separated).");
        return;
      }
      step = { op: addOp, columns: cols };
    } else if (addOp === "filter") {
      const col = String(addForm.column || "").trim();
      if (!col) {
        setStepBuilderErr("Select a column for the filter.");
        return;
      }
      step = { op: "filter", column: col, where: String(addForm.where || "notBlank") };
      if (step.where === "eq" || step.where === "ne") step.value = addForm.value;
    } else if (addOp === "filterExpr") {
      const ex = String(addForm.expression || "").trim();
      if (!ex) {
        setStepBuilderErr("Enter a boolean expression.");
        return;
      }
      step = { op: "filterExpr", expression: ex };
    } else if (addOp === "addExprColumn") {
      const name = String(addForm.name || "").trim();
      const ex = String(addForm.expression || "").trim();
      if (!name || !ex) {
        setStepBuilderErr("Enter output column name and expression.");
        return;
      }
      step = { op: "addExprColumn", name, expression: ex };
    } else if (addOp === "trimColumn" || addOp === "cleanTextColumn" || addOp === "upperColumn" || addOp === "lowerColumn") {
      const col = String(addForm.column || "").trim();
      if (!col) {
        setStepBuilderErr("Select a column.");
        return;
      }
      step = { op: addOp, column: col };
    } else if (addOp === "replaceValues") {
      const col = String(addForm.column || "").trim();
      if (!col) {
        setStepBuilderErr("Select a column.");
        return;
      }
      step = { op: "replaceValues", column: col, from: addForm.from != null ? String(addForm.from) : "", to: addForm.to != null ? String(addForm.to) : "" };
    } else if (addOp === "addConstant") {
      const name = String(addForm.name || "").trim();
      if (!name) {
        setStepBuilderErr("Enter constant column name.");
        return;
      }
      step = { op: "addConstant", name, value: addForm.value };
    } else {
      step = { op: addOp };
    }

    onTransformationScriptChange((prev) => {
      const cur = parsePipelineSafe(prev) || { version: 1, steps: [] };
      if (!Array.isArray(cur.steps)) cur.steps = [];
      cur.version = 1;
      cur.steps.push(step);
      return JSON.stringify(cur, null, 2);
    });
  }, [addOp, addForm, onTransformationScriptChange]);

  const formatJson = () => {
    try {
      const o = JSON.parse(transformationScript || "{}");
      onTransformationScriptChange(JSON.stringify(o, null, 2));
    } catch {
      /* keep */
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(transformationScript || "");
    } catch {
      /* ignore */
    }
  };

  const applyTemplate = () => {
    if (!templateId) return;
    let obj;
    if (templateId === "basic") obj = buildBasicCleanupPipeline();
    else if (templateId === "collection") obj = buildCollectionReportCleanupPipeline(previewCols);
    else if (templateId === "blank") {
      const h = columnHints[0];
      if (!h) return;
      obj = buildRemoveBlankRowsPipeline(h.raw, h.id);
    } else if (templateId === "header") {
      const h = columnHints[0];
      if (!h) return;
      obj = buildRemoveHeaderRowPipeline(h.raw, headerFilterText, h.id);
    }
    if (obj) onTransformationScriptChange(JSON.stringify(obj, null, 2));
    setTemplateId("");
  };

  const validationBlocks = useMemo(() => {
    const errs = [...(clientValidation?.errors || []), ...serverValidationErrors];
    return errs;
  }, [clientValidation, serverValidationErrors]);

  const warnBlocks = useMemo(() => {
    return [...(clientValidation?.warnings || []), ...(transformWarnings || [])];
  }, [clientValidation, transformWarnings]);

  return (
    <div className="dataflows-wizard-grid dataflows-wizard-grid--transform">
      <div className="dataflows-transform-help">
        <h4 className="dataflows-transform-help__title">CollectEase transformation pipeline</h4>
        <p className="text-muted dataflows-transform-help__text">
          This is <strong>not</strong> Microsoft Power Query M. The server runs CollectEase JSON steps only. Use the step
          builder below, insert a template, or edit <strong>Advanced JSON</strong>. Row expressions use <code>and</code>,{" "}
          <code>or</code>, <code>not</code> — not <code>&amp;&amp;</code> / <code>||</code> / <code>!</code>. Use{" "}
          <code>!=</code> for “not equal” (not <code>&lt;&gt;</code>, which the expression parser does not support).
        </p>
        <p className="text-muted dataflows-transform-help__text" style={{ fontSize: "0.82rem", marginBottom: 0 }}>
          Supported operations: {SUPPORTED_OP_LIST.join(", ")}.
        </p>
      </div>

      {validationBlocks.length ? (
        <div className="dataflows-alert dataflows-alert--err" role="alert">
          <AlertCircle size={18} />
          <div className="dataflows-transform-diag-list">
            {validationBlocks.map((d, i) => (
              <div key={i} className="dataflows-transform-diag">
                <div className="dataflows-transform-diag__head">
                  {d.stepIndex ? `Step ${d.stepIndex}` : "Pipeline"}
                  {d.op ? ` · ${d.op}` : ""}
                </div>
                <div>
                  <strong>Problem:</strong> {d.problem}
                </div>
                {d.suggestion ? (
                  <div className="dataflows-transform-diag__fix">
                    <strong>Suggestion:</strong> {d.suggestion}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {warnBlocks.length > 0 && validationBlocks.length === 0 ? (
        <div className="dataflows-alert dataflows-alert--warn" role="status">
          <AlertCircle size={18} />
          <div className="dataflows-transform-diag-list">
            {warnBlocks.map((d, i) => (
              <div key={i} className="dataflows-transform-diag">
                <div className="dataflows-transform-diag__head">
                  {d.stepIndex ? `Step ${d.stepIndex}` : "Pipeline"}
                  {d.op ? ` · ${d.op}` : ""}
                </div>
                <div>{d.problem}</div>
                {d.suggestion ? <div className="dataflows-transform-diag__fix">{d.suggestion}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <DataflowTransformToolbar
        columns={previewCols}
        onAddStep={handleQuickAddStep}
        disabled={busy || transformPreviewBusy}
      />

      <div className="dataflows-transform-steps-panel">
        <h4 className="dataflows-transform-steps-panel__title">Pipeline steps</h4>
        <DataflowStepList
          transformationScript={transformationScript}
          onPipelineChange={handlePipelineChange}
          disabled={busy || transformPreviewBusy}
        />
      </div>

      <div className="dataflows-transform-toolbar">
        <div className="dataflows-transform-toolbar__templates">
          <label className="dataflows-field dataflows-field--inline">
            <span>Template</span>
            <select className="dataflows-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose…</option>
              {TEMPLATE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {templateId === "header" ? (
            <label className="dataflows-field dataflows-field--inline">
              <span>Header text to drop</span>
              <input
                className="dataflows-input"
                value={headerFilterText}
                onChange={(e) => setHeaderFilterText(e.target.value)}
              />
            </label>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={applyTemplate} disabled={!templateId}>
            <Wand2 size={14} /> Insert template
          </button>
        </div>
      </div>

      <div className="dataflows-step-builder">
        <div className="dataflows-step-builder__head">
          <Sparkles size={16} />
          <span>Add step</span>
        </div>
        {stepBuilderErr ? (
          <div className="dataflows-alert dataflows-alert--err" role="alert">
            <AlertCircle size={16} /> {stepBuilderErr}
          </div>
        ) : null}
        <div className="dataflows-step-builder__row">
          <label className="dataflows-field dataflows-field--inline">
            <span>Operation</span>
            <select className="dataflows-select" value={addOp} onChange={(e) => onPickOp(e.target.value)}>
              {opChoices().map((c) => (
                <option key={c.op} value={c.op}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={appendStep}>
            Append to pipeline
          </button>
        </div>
        {selectedMeta?.description ? (
          <p className="text-muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0.5rem" }}>
            {selectedMeta.description}
          </p>
        ) : null}

        {addOp === "rename" ? (
          <RenameStepForm previewCols={previewCols} mergeAddForm={mergeAddForm} />
        ) : addOp === "useSheet" || addOp === "appendSheet" ? (
          <label className="dataflows-field">
            <span>Sheet name</span>
            <select
              className="dataflows-select"
              value={addForm.sheet || ""}
              onChange={(e) => mergeAddForm({ sheet: e.target.value })}
            >
              <option value="">Select…</option>
              {sheetNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        ) : addOp === "select" || addOp === "removeColumns" ? (
          <label className="dataflows-field">
            <span>Columns (comma-separated)</span>
            <input
              className="dataflows-input"
              placeholder="ColA, ColB"
              onChange={(e) =>
                mergeAddForm({
                  columns: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                })
              }
            />
          </label>
        ) : addOp === "removeTopRows" ? (
          <label className="dataflows-field">
            <span>Rows to remove from top</span>
            <input
              type="number"
              min={0}
              className="dataflows-input"
              style={{ maxWidth: "8rem" }}
              value={addForm.count ?? ""}
              onChange={(e) => mergeAddForm({ count: e.target.value })}
            />
          </label>
        ) : addOp === "filter" ? (
          <div className="dataflows-step-builder__stack">
            <label className="dataflows-field">
              <span>Column</span>
              <select
                className="dataflows-select"
                value={addForm.column || ""}
                onChange={(e) => mergeAddForm({ column: e.target.value })}
              >
                <option value="">Select…</option>
                {previewCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="dataflows-field">
              <span>Where</span>
              <select
                className="dataflows-select"
                value={addForm.where || "notBlank"}
                onChange={(e) => mergeAddForm({ where: e.target.value })}
              >
                <option value="notBlank">notBlank</option>
                <option value="blank">blank</option>
                <option value="eq">eq</option>
                <option value="ne">ne</option>
              </select>
            </label>
            {addForm.where === "eq" || addForm.where === "ne" ? (
              <label className="dataflows-field">
                <span>Value</span>
                <input className="dataflows-input" onChange={(e) => mergeAddForm({ value: e.target.value })} />
              </label>
            ) : null}
          </div>
        ) : addOp === "filterExpr" ? (
          <label className="dataflows-field">
            <span>Expression</span>
            <textarea
              className="dataflows-code dataflows-code--sm"
              rows={3}
              placeholder="not IsBlank(Unit) and Unit != 'Unit'"
              value={addForm.expression || ""}
              onChange={(e) => mergeAddForm({ expression: e.target.value })}
            />
          </label>
        ) : addOp === "addExprColumn" ? (
          <div className="dataflows-step-builder__stack">
            <label className="dataflows-field">
              <span>Column name</span>
              <input className="dataflows-input" onChange={(e) => mergeAddForm({ name: e.target.value })} />
            </label>
            <label className="dataflows-field">
              <span>Expression</span>
              <textarea
                className="dataflows-code dataflows-code--sm"
                rows={3}
                value={addForm.expression || ""}
                onChange={(e) => mergeAddForm({ expression: e.target.value })}
              />
            </label>
          </div>
        ) : addOp === "trimColumn" ||
          addOp === "cleanTextColumn" ||
          addOp === "upperColumn" ||
          addOp === "lowerColumn" ||
          addOp === "replaceValues" ? (
          <ColumnPickFields addOp={addOp} previewCols={previewCols} mergeAddForm={mergeAddForm} />
        ) : addOp === "addConstant" ? (
          <div className="dataflows-step-builder__stack">
            <label className="dataflows-field">
              <span>Name</span>
              <input className="dataflows-input" onChange={(e) => mergeAddForm({ name: e.target.value })} />
            </label>
            <label className="dataflows-field">
              <span>Value (string)</span>
              <input className="dataflows-input" onChange={(e) => mergeAddForm({ value: e.target.value })} />
            </label>
          </div>
        ) : addOp === "coerceTypes" ? (
          <p className="text-muted" style={{ fontSize: "0.8rem" }}>
            For coerce types, add a JSON object in Advanced editor:{" "}
            <code>{`{ "op": "coerceTypes", "map": { "Col": "number" } }`}</code>
          </p>
        ) : null}
      </div>

      <details className="dataflows-transform-details">
        <summary>
          Column identifiers &amp; samples <ChevronDown size={14} className="dataflows-transform-details__chev" />
        </summary>
        <p className="text-muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
          Use the identifier column in expressions. Helpers: {EXPR_HELPER_FUNCTIONS.map((h) => h.name).join(", ")}.
        </p>
        <div className="dataflows-colhint-table-wrap">
          <table className="dataflows-colhint-table">
            <thead>
              <tr>
                <th>Original column</th>
                <th>Identifier</th>
                <th>Sample</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {columnHints.length ? (
                columnHints.map((h) => (
                  <tr key={h.raw + h.id}>
                    <td>
                      <code>{h.raw || "(empty)"}</code>
                    </td>
                    <td>
                      <code>{h.id}</code>
                    </td>
                    <td className="dataflows-colhint-sample">{h.sample || "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => void navigator.clipboard.writeText(h.id)}
                      >
                        <Clipboard size={14} /> Copy id
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-muted">
                    Load the Excel preview (previous step) to list columns.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <ul className="dataflows-expr-helpers text-muted">
          {EXPR_HELPER_FUNCTIONS.map((h) => (
            <li key={h.name}>
              <code>{h.signature}</code> — {h.description}
            </li>
          ))}
        </ul>
      </details>

      <div className="dataflows-transform-split">
        <div className="dataflows-transform-split__editor">
          <label className="dataflows-field dataflows-field--wide">
            <span>Advanced JSON</span>
            <textarea
              className="dataflows-code dataflows-code--tall"
              rows={18}
              value={transformationScript}
              onChange={(e) => onTransformationScriptChange(e.target.value)}
            />
          </label>
          {transformErr ? (
            <div className="dataflows-alert dataflows-alert--err" role="alert">
              <AlertCircle size={18} /> {transformErr}
            </div>
          ) : null}
          <div className="dataflows-actions dataflows-actions--wrap">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onRunPreview("manual")}
              disabled={busy || transformPreviewBusy || !clientValidation?.ok}
            >
              {busy ? <Loader2 className="dataflows-spin" size={16} /> : null}
              Run preview
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onValidateOnly()} disabled={busy}>
              Validate only
            </button>
            <button type="button" className="btn btn-ghost" onClick={formatJson}>
              Format JSON
            </button>
            <button type="button" className="btn btn-ghost" onClick={copyJson}>
              <Clipboard size={16} /> Copy
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (window.confirm("Reset transformation JSON to the default starter pipeline?")) {
                  onTransformationScriptChange(defaultPipelineText);
                }
              }}
            >
              <RotateCcw size={16} /> Reset
            </button>
            {transformPreviewBusy ? (
              <span className="text-muted">
                <Loader2 className="dataflows-spin" size={14} /> Updating preview…
              </span>
            ) : null}
            {transformOk && !transformPreviewBusy && clientValidation?.ok ? (
              <span className="text-muted">
                <Check size={16} style={{ verticalAlign: "text-bottom" }} /> Preview OK — you can go to the next step.
              </span>
            ) : null}
          </div>
        </div>
        <div className="dataflows-transform-split__output">
          <div className="dataflows-transform-split__out-head">
            <span className="dataflows-transform-split__out-title">Output preview</span>
          </div>
          {transformOutput?.columns?.length ? (
            <DataflowsExcelSheetPreviewEmbed
              compact
              declaredRowCount={transformOutput.rowCount}
              columns={transformOutput.columns}
              rows={transformOutput.rows}
            />
          ) : (
            <p className="text-muted dataflows-transform-placeholder">
              {transformPreviewBusy
                ? "Running preview…"
                : "Successful preview will appear here (auto-updates when JSON is valid on the client)."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RenameStepForm({ previewCols, mergeAddForm }) {
  const [pairs, setPairs] = useState([{ from: "", to: "" }]);
  const sync = (next) => {
    setPairs(next);
    mergeAddForm({ renamePairs: next });
  };
  return (
    <div className="dataflows-step-builder__stack">
      {pairs.map((p, i) => (
        <div key={i} className="dataflows-rename-row">
          <select
            className="dataflows-select"
            value={p.from}
            onChange={(e) => {
              const n = [...pairs];
              n[i] = { ...n[i], from: e.target.value };
              sync(n);
            }}
          >
            <option value="">Source column…</option>
            {previewCols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span aria-hidden>→</span>
          <input
            className="dataflows-input"
            placeholder="New name"
            value={p.to}
            onChange={(e) => {
              const n = [...pairs];
              n[i] = { ...n[i], to: e.target.value };
              sync(n);
            }}
          />
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => sync([...pairs, { from: "", to: "" }])}>
        + Add rename
      </button>
    </div>
  );
}

function ColumnPickFields({ addOp, previewCols, mergeAddForm }) {
  return (
    <div className="dataflows-step-builder__stack">
      <label className="dataflows-field">
        <span>Column</span>
        <select className="dataflows-select" onChange={(e) => mergeAddForm({ column: e.target.value })}>
          <option value="">Select…</option>
          {previewCols.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {addOp === "replaceValues" ? (
        <>
          <label className="dataflows-field">
            <span>From</span>
            <input className="dataflows-input" onChange={(e) => mergeAddForm({ from: e.target.value })} />
          </label>
          <label className="dataflows-field">
            <span>To</span>
            <input className="dataflows-input" onChange={(e) => mergeAddForm({ to: e.target.value })} />
          </label>
        </>
      ) : null}
    </div>
  );
}

/** Local duplicate of grid preview (keeps transform step self-contained). */
function DataflowsExcelSheetPreviewEmbed({ columns, rows, compact, declaredRowCount }) {
  const cols = Array.isArray(columns) ? columns : [];
  const data = Array.isArray(rows) ? rows : [];
  const colTpl = cols.length ? `2.75rem repeat(${cols.length}, minmax(7rem, max-content))` : "1fr";
  const meta = compact
    ? data.length
      ? `${data.length} row${data.length === 1 ? "" : "s"} in preview${
          declaredRowCount != null && declaredRowCount !== data.length ? ` · engine row count ${declaredRowCount}` : ""
        }`
      : declaredRowCount != null
        ? `No rows in this preview sample · engine row count ${declaredRowCount}`
        : "No preview rows yet."
    : `${data.length} row${data.length === 1 ? "" : "s"}`;

  function cell(value) {
    if (value == null) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  return (
    <div className={`dataflows-excel-preview${compact ? " dataflows-excel-preview--compact" : ""}`} role="region">
      <p className="dataflows-excel-meta text-muted">{meta}</p>
      <div className="dataflows-excel-scroll">
        <div className="dataflows-excel-sheet">
          <div className="dataflows-excel-row dataflows-excel-row--header" style={{ gridTemplateColumns: colTpl }}>
            <div className="dataflows-excel-gutter" aria-hidden />
            {cols.map((c) => (
              <div key={c} className="dataflows-excel-cell dataflows-excel-cell--header">
                <span className="dataflows-excel-hname">{c}</span>
              </div>
            ))}
          </div>
          {data.map((row, ri) => (
            <div key={ri} className="dataflows-excel-row dataflows-excel-row--data" style={{ gridTemplateColumns: colTpl }}>
              <div className="dataflows-excel-gutter">{ri + 1}</div>
              {cols.map((c) => (
                <div key={c} className="dataflows-excel-cell">
                  {cell(row[c])}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
