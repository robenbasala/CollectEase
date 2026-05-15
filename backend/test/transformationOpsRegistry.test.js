"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const reg = require(path.join(__dirname, "../../shared/transformationOpsRegistry.cjs"));
const { runTransformationEngine } = require("../src/services/transformationEngine");

describe("transformationOpsRegistry", () => {
  it("lists known ops including removeTopRows and promoteHeaders", () => {
    assert.ok(reg.SUPPORTED_OP_LIST.includes("removeTopRows"));
    assert.ok(reg.SUPPORTED_OP_LIST.includes("promoteHeaders"));
    assert.ok(reg.SUPPORTED_OP_LIST.includes("filterExpr"));
  });

  it("normalizeStep maps expr to expression and columns to map for rename", () => {
    const a = reg.normalizeStep({ op: "filterExpr", expr: "1 < 2" });
    assert.equal(a.expression, "1 < 2");
    assert.equal(a.expr, undefined);
    const b = reg.normalizeStep({ op: "rename", columns: { Old: "New" } });
    assert.deepEqual(b.map, { Old: "New" });
  });

  it("warns when skipRows is used (canonical is removeTopRows)", () => {
    const { errors, warnings } = reg.validatePipelineText(
      JSON.stringify({ version: 1, steps: [{ op: "skipRows", count: 1 }] }),
      {}
    );
    assert.equal(errors.length, 0);
    assert.ok(warnings.some((w) => /skipRows/i.test(w.problem)));
  });

  it("rejects unknown op with helpful suggestion", () => {
    const { errors } = reg.validatePipelineText(
      JSON.stringify({ version: 1, steps: [{ op: "notARealOp" }] }),
      { sheetNames: [] }
    );
    assert.ok(errors.length >= 1);
    assert.match(errors[0].problem, /notARealOp/i);
    assert.ok(errors[0].suggestion.includes("Supported operations"));
  });

  it("errors when filterExpr missing expression", () => {
    const { errors } = reg.validatePipelineText(
      JSON.stringify({ version: 1, steps: [{ op: "filterExpr" }] }),
      {}
    );
    assert.ok(errors.length >= 1);
    assert.match(errors[0].problem, /expression/i);
  });

  it("warns when filterExpr uses expr key instead of expression", () => {
    const { errors, warnings } = reg.validatePipelineText(
      JSON.stringify({ version: 1, steps: [{ op: "filterExpr", expr: "true" }] }),
      {}
    );
    assert.equal(errors.length, 0);
    assert.ok(warnings.some((w) => String(w.problem).includes("expression")));
  });

  it("accepts rename with columns alias (warning)", () => {
    const { errors, warnings } = reg.validatePipelineText(
      JSON.stringify({ version: 1, steps: [{ op: "rename", columns: { A: "B" } }] }),
      {}
    );
    assert.equal(errors.length, 0);
    assert.ok(warnings.some((w) => /columns/.test(w.problem)));
  });

  it("buildCollectionReportCleanupPipeline uses renamed columns in filterExpr", () => {
    const cols = ["Collection Report Standard", "Collection Report Standard_2", "Collection Report Standard_3"];
    const p = reg.buildCollectionReportCleanupPipeline(cols);
    assert.equal(p.steps[1].op, "rename");
    assert.ok(p.steps[2].expression.includes("TenantId"));
    assert.ok(p.steps[2].expression.includes("Unit"));
  });
});

describe("runTransformationEngine", () => {
  it("runs trimAll", () => {
    const out = runTransformationEngine(JSON.stringify({ version: 1, steps: [{ op: "trimAll" }] }), [
      { x: "  a  " }
    ]);
    assert.equal(out.ok, true);
    assert.equal(out.rows[0].x, "a");
  });

  it("runs rename with map", () => {
    const out = runTransformationEngine(
      JSON.stringify({ version: 1, steps: [{ op: "rename", map: { Old: "New" } }] }),
      [{ Old: 1 }]
    );
    assert.equal(out.ok, true);
    assert.equal(out.rows[0].New, 1);
  });

  it("runs rename with columns alias in engine", () => {
    const out = runTransformationEngine(
      JSON.stringify({ version: 1, steps: [{ op: "rename", columns: { Old: "New" } }] }),
      [{ Old: 1 }]
    );
    assert.equal(out.ok, true);
    assert.equal(out.rows[0].New, 1);
  });

  it("runs filterExpr with and / Not / IsBlank", () => {
    const out = runTransformationEngine(
      JSON.stringify({
        version: 1,
        steps: [{ op: "filterExpr", expression: "a > 0 and Not(IsBlank(b))" }]
      }),
      [
        { a: 1, b: "x" },
        { a: 2, b: "" }
      ]
    );
    assert.equal(out.ok, true);
    assert.equal(out.rows.length, 1);
  });

  it("runs removeTopRows then promoteHeaders", () => {
    const out = runTransformationEngine(
      JSON.stringify({
        version: 1,
        steps: [{ op: "removeTopRows", count: 1 }, { op: "promoteHeaders" }]
      }),
      [
        { A: "skip", B: "me" },
        { A: "h1", B: "h2" },
        { A: "1", B: "2" }
      ]
    );
    assert.equal(out.ok, true);
    assert.deepEqual(out.rows[0], { h1: "1", h2: "2" });
  });

  it("returns validation errors before execution for bad pipeline", () => {
    const out = runTransformationEngine(
      JSON.stringify({ version: 1, steps: [{ op: "filterExpr" }] }),
      [{ a: 1 }]
    );
    assert.equal(out.ok, false);
    assert.ok(Array.isArray(out.validationErrors));
    assert.ok(out.validationErrors.length >= 1);
  });

  it("runs collection-style cleanup pipeline", () => {
    const cols = ["Collection Report Standard", "Collection Report Standard_2", "Collection Report Standard_3"];
    const script = JSON.stringify(reg.buildCollectionReportCleanupPipeline(cols));
    const rows = [
      {
        "Collection Report Standard": "Unit",
        "Collection Report Standard_2": "Code",
        "Collection Report Standard_3": "Name"
      },
      {
        "Collection Report Standard": "704",
        "Collection Report Standard_2": "t1",
        "Collection Report Standard_3": "Ann"
      }
    ];
    const out = runTransformationEngine(script, rows);
    assert.equal(out.ok, true);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].Unit, "704");
  });
});
