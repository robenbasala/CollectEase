const express = require("express");
const ctrl = require("../controllers/dashboard.controller");

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/regions", wrap(ctrl.getRegions));
router.get("/portfolios", wrap(ctrl.getPortfolios));
router.get("/properties", wrap(ctrl.getProperties));
router.get("/summary", wrap(ctrl.getSummary));
router.get("/units", wrap(ctrl.getUnits));

module.exports = router;
