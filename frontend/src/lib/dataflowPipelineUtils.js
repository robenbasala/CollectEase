/**
 * Client helpers for CollectEase JSON transform pipelines (version 1).
 * Steps use `op` (alias `type` accepted when saving).
 */

import { TRANSFORMATION_OPS, validatePipelineText } from "@collectease/transformation-ops";

export function parsePipelineText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { version: 1, steps: [] };
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) return { version: 1, steps: obj };
    if (obj && typeof obj === "object") {
      return {
        version: Number(obj.version) || 1,
        steps: Array.isArray(obj.steps) ? obj.steps : []
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function stringifyPipeline(pipeline) {
  const p = pipeline && typeof pipeline === "object" ? pipeline : { version: 1, steps: [] };
  return JSON.stringify(
    {
      version: p.version || 1,
      steps: Array.isArray(p.steps) ? p.steps : []
    },
    null,
    2
  );
}

export function getStepLabel(step) {
  if (!step || typeof step !== "object") return "Invalid step";
  const op = String(step.op || step.type || "").trim();
  const meta = TRANSFORMATION_OPS[op] || TRANSFORMATION_OPS[op.replace(/s$/, "")];
  if (meta?.label) return meta.label;
  if (op === "removeTopRows") return `Remove top ${step.count ?? "?"} row(s)`;
  if (op === "filterRows" && step.where) {
    return `Filter: ${step.where.column} ${step.where.operator || ""}`;
  }
  if (op === "rename" && (step.map || step.columns)) {
    const n = Object.keys(step.map || step.columns || {}).length;
    return `Rename ${n} column(s)`;
  }
  return op || "Step";
}

/** @param {object} pipeline @param {object} step @param {{ enabled?: boolean }} [opts] */
export function appendStep(pipeline, step, opts = {}) {
  const p = parsePipelineText(stringifyPipeline(pipeline)) || { version: 1, steps: [] };
  const s = { ...step, op: step.op || step.type };
  delete s.type;
  if (opts.enabled === false) s.enabled = false;
  p.steps.push(s);
  return p;
}

export function removeStepAt(pipeline, index) {
  const p = parsePipelineText(stringifyPipeline(pipeline)) || { version: 1, steps: [] };
  p.steps = p.steps.filter((_, i) => i !== index);
  return p;
}

export function moveStep(pipeline, index, direction) {
  const p = parsePipelineText(stringifyPipeline(pipeline)) || { version: 1, steps: [] };
  const j = index + direction;
  if (j < 0 || j >= p.steps.length) return p;
  const next = [...p.steps];
  const t = next[index];
  next[index] = next[j];
  next[j] = t;
  p.steps = next;
  return p;
}

export function toggleStepEnabled(pipeline, index) {
  const p = parsePipelineText(stringifyPipeline(pipeline)) || { version: 1, steps: [] };
  p.steps = p.steps.map((s, i) => {
    if (i !== index) return s;
    const en = s.enabled !== false;
    return { ...s, enabled: !en };
  });
  return p;
}

export function updateStepAt(pipeline, index, patch) {
  const p = parsePipelineText(stringifyPipeline(pipeline)) || { version: 1, steps: [] };
  p.steps = p.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
  return p;
}

export function validatePipeline(scriptText, ctx) {
  return validatePipelineText(scriptText, ctx);
}

/** Preset steps for toolbar buttons */
export const QUICK_STEPS = {
  removeFirstRow: { op: "removeTopRows", count: 1 },
  promoteHeaders: { op: "promoteHeaders" },
  trimAll: { op: "trimAll" },
  cleanText: { op: "cleanText" },
  removeEmptyRows: { op: "removeEmptyRows" },
  removeEmptyColumns: { op: "removeEmptyColumns" }
};
