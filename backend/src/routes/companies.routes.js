const express = require("express");
const ctrl = require("../controllers/companies.controller");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", wrap(ctrl.listCompanies));

module.exports = router;
