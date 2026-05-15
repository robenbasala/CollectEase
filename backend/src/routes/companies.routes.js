const express = require("express");
const ctrl = require("../controllers/companies.controller");
const dataflowsCtrl = require("../controllers/dataflows.controller");
const { requireSuperAdmin, requireCompanyAdmin } = require("../middleware/firebaseAuth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", wrap(ctrl.listCompanies));
router.post("/", requireSuperAdmin, wrap(ctrl.createCompany));

/** Nested under /api/companies so this path is not shadowed by other /api mounts. */
router.get("/:companyId/dataflows", requireCompanyAdmin, wrap(dataflowsCtrl.listByCompany));
router.post("/:companyId/dataflows", requireCompanyAdmin, wrap(dataflowsCtrl.createOne));

module.exports = router;
