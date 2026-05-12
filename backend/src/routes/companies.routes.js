const express = require("express");
const ctrl = require("../controllers/companies.controller");
const { requireSuperAdmin } = require("../middleware/firebaseAuth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", wrap(ctrl.listCompanies));
router.post("/", requireSuperAdmin, wrap(ctrl.createCompany));

module.exports = router;
