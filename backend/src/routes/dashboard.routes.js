const express = require("express");
const ctrl = require("../controllers/dashboard.controller");
const legal = require("../controllers/legalCases.controller");

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/regions", wrap(ctrl.getRegions));
router.get("/portfolios", wrap(ctrl.getPortfolios));
router.get("/properties", wrap(ctrl.getProperties));
router.get("/summary", wrap(ctrl.getSummary));
router.get("/units", wrap(ctrl.getUnits));
router.patch("/unit-row", wrap(ctrl.patchUnitRow));
router.get("/unit-notes", wrap(ctrl.getUnitNotes));
router.post("/unit-notes", wrap(ctrl.postUnitNote));
router.patch("/unit-notes/:id", wrap(ctrl.patchUnitNote));
router.delete("/unit-notes/:id", wrap(ctrl.deleteUnitNote));
router.get("/unit-legal-history", wrap(ctrl.getUnitLegalHistory));

router.get("/unit-legal-cases", wrap(legal.listCases));
router.post("/unit-legal-cases", wrap(legal.createCase));
router.get("/unit-legal-cases/:id", wrap(legal.getCase));
router.patch("/unit-legal-cases/:id", wrap(legal.patchCase));
router.delete("/unit-legal-cases/:id", wrap(legal.deleteCase));
router.get("/unit-legal-cases/:id/statuses", wrap(legal.listCaseStatuses));
router.post("/unit-legal-cases/:id/statuses", wrap(legal.postCaseStatus));
router.delete("/unit-legal-case-statuses/:statusId", wrap(legal.deleteCaseStatus));
router.get("/property-legal-status-options", wrap(legal.getPropertyLegalStatusOptions));

module.exports = router;
