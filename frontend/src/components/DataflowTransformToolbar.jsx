import { TRANSFORMATION_OPS } from "@collectease/transformation-ops";
import { QUICK_STEPS } from "../lib/dataflowPipelineUtils.js";

const BUTTONS = [
  { id: "removeFirstRow", label: "Remove first row", step: QUICK_STEPS.removeFirstRow },
  { id: "removeTopX", label: "Remove top X rows…", needsCount: true },
  { id: "promoteHeaders", label: "First row as column names", step: QUICK_STEPS.promoteHeaders },
  { id: "trimAll", label: "Trim all cells", step: QUICK_STEPS.trimAll },
  { id: "cleanText", label: "Clean text", step: QUICK_STEPS.cleanText },
  { id: "removeEmptyRows", label: "Remove empty rows", step: QUICK_STEPS.removeEmptyRows },
  { id: "removeEmptyColumns", label: "Remove empty columns", step: QUICK_STEPS.removeEmptyColumns },
  { id: "filter", label: "Filter data…", action: "filter" },
  { id: "rename", label: "Rename column…", action: "rename" },
  { id: "replace", label: "Replace value…", action: "replace" },
  { id: "keepCols", label: "Keep selected columns…", action: "keepCols" },
  { id: "removeCols", label: "Remove selected columns…", action: "removeCols" },
  { id: "dedupe", label: "Deduplicate rows…", action: "dedupe" },
  { id: "normalizeDate", label: "Normalize dates…", action: "normalizeDate" },
  { id: "normalizeMoney", label: "Normalize money…", action: "normalizeMoney" },
  { id: "addCalc", label: "Add calculated column…", action: "addCalc" }
];

export default function DataflowTransformToolbar({ columns = [], onAddStep, disabled }) {
  function handleClick(btn) {
    if (disabled) return;
    if (btn.needsCount) {
      const raw = window.prompt("How many rows to remove from the top?", "1");
      if (raw == null) return;
      const count = Number(raw);
      if (!Number.isFinite(count) || count < 0) return;
      onAddStep({ op: "removeTopRows", count: Math.floor(count) });
      return;
    }
    if (btn.step) {
      onAddStep({ ...btn.step });
      return;
    }
    if (btn.action === "filter") {
      const col = columns[0] || window.prompt("Column name to filter on:");
      if (!col) return;
      const operator = window.prompt(
        "Operator: notEmpty, empty, equals, contains, greaterThan, lessThan",
        "notEmpty"
      );
      if (!operator) return;
      const where = { column: col, operator };
      if (!["notEmpty", "empty"].includes(operator)) {
        const value = window.prompt("Value (if needed):", "");
        if (value != null && value !== "") where.value = value;
      }
      onAddStep({ op: "filterRows", where });
      return;
    }
    if (btn.action === "rename") {
      const from = window.prompt("Current column name:");
      if (!from) return;
      const to = window.prompt("New column name:");
      if (!to) return;
      onAddStep({ op: "rename", map: { [from]: to } });
      return;
    }
    if (btn.action === "replace") {
      const column = window.prompt('Column name (or * for all):', "*");
      if (column == null) return;
      const from = window.prompt("Replace text:", "");
      if (from == null) return;
      const to = window.prompt("With:", "");
      if (to == null) return;
      onAddStep({ op: "replaceValues", column, from, to });
      return;
    }
    if (btn.action === "keepCols") {
      const raw = window.prompt("Columns to keep (comma-separated):", columns.slice(0, 5).join(", "));
      if (!raw) return;
      onAddStep({
        op: "select",
        columns: raw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      });
      return;
    }
    if (btn.action === "removeCols") {
      const raw = window.prompt("Columns to remove (comma-separated):");
      if (!raw) return;
      onAddStep({
        op: "removeColumns",
        columns: raw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      });
      return;
    }
    if (btn.action === "dedupe") {
      const raw = window.prompt("Key columns (comma-separated):", columns[0] || "");
      if (!raw) return;
      const keep = window.prompt("Keep: first or last", "first");
      onAddStep({
        op: "deduplicate",
        columns: raw.split(",").map((x) => x.trim()).filter(Boolean),
        keep: keep === "last" ? "last" : "first"
      });
      return;
    }
    if (btn.action === "normalizeDate") {
      const raw = window.prompt("Date columns (comma-separated):", columns.join(", "));
      if (!raw) return;
      onAddStep({
        op: "normalizeDate",
        columns: raw.split(",").map((x) => x.trim()).filter(Boolean)
      });
      return;
    }
    if (btn.action === "normalizeMoney") {
      const raw = window.prompt("Money columns (comma-separated):", columns.join(", "));
      if (!raw) return;
      onAddStep({
        op: "normalizeMoney",
        columns: raw.split(",").map((x) => x.trim()).filter(Boolean)
      });
      return;
    }
    if (btn.action === "addCalc") {
      const name = window.prompt("New column name:");
      if (!name) return;
      const expression = window.prompt("Expression (expr-eval; use column identifiers):", "");
      if (!expression) return;
      onAddStep({ op: "addExprColumn", name, expression });
    }
  }

  return (
    <div className="dataflows-etl-toolbar">
      <p className="dataflows-etl-toolbar__title text-muted">Quick transforms — each click adds a step and refreshes preview</p>
      <div className="dataflows-etl-toolbar__grid">
        {BUTTONS.map((btn) => (
          <button
            key={btn.id}
            type="button"
            className="btn btn-ghost btn-sm dataflows-etl-toolbar__btn"
            disabled={disabled}
            onClick={() => handleClick(btn)}
            title={TRANSFORMATION_OPS[btn.step?.op]?.description || btn.label}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
