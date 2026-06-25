const express = require("express");
const ctrl = require("../controllers/companies.controller");
const { requireSuperAdmin, requireCompanyAdmin } = require("../middleware/firebaseAuth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", wrap(ctrl.listCompanies));
router.post("/", requireSuperAdmin, wrap(ctrl.createCompany));
router.put("/:id", requireSuperAdmin, wrap(ctrl.updateCompany));
router.delete("/:id", requireSuperAdmin, wrap(ctrl.deleteCompany));

/** Nested under /api/companies so this path is not shadowed by other /api mounts. */

module.exports = router;
