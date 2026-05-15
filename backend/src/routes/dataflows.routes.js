const express = require("express");
const { requireCompanyAdmin } = require("../middleware/firebaseAuth");
const ctrl = require("../controllers/dataflows.controller");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Literal /dataflows/* paths before any `/dataflows/:id` so `read-source` is never captured as an id. */
router.post("/dataflows/read-source", requireCompanyAdmin, wrap(ctrl.postReadSource));
router.post("/dataflows/preview", requireCompanyAdmin, wrap(ctrl.postPreview));
router.post("/dataflows/auto-map", requireCompanyAdmin, wrap(ctrl.postAutoMap));

router.get("/dataflows/:id/runs", requireCompanyAdmin, wrap(ctrl.listRuns));
router.get("/dataflows/:id", requireCompanyAdmin, wrap(ctrl.getOne));
router.put("/dataflows/:id", requireCompanyAdmin, wrap(ctrl.updateOne));
router.delete("/dataflows/:id", requireCompanyAdmin, wrap(ctrl.deleteOne));

router.post("/dataflows/:id/run", requireCompanyAdmin, wrap(ctrl.postRun));

router.get("/dataflow-runs/:runId/errors", requireCompanyAdmin, wrap(ctrl.getRunErrors));
router.get("/dataflow-runs/:runId", requireCompanyAdmin, wrap(ctrl.getRun));

router.get("/sql/tables", requireCompanyAdmin, wrap(ctrl.getSqlTables));
router.get("/sql/tables/:tableName/schema", requireCompanyAdmin, wrap(ctrl.getSqlTableSchema));

module.exports = router;
