const express = require("express");
const ctrl = require("../controllers/admin.controller");

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/regions", wrap(ctrl.listRegions));
router.post("/regions", wrap(ctrl.createRegion));
router.put("/regions/:id", wrap(ctrl.updateRegion));
router.delete("/regions/:id", wrap(ctrl.deleteRegion));

router.get("/portfolios", wrap(ctrl.listPortfolios));
router.post("/portfolios", wrap(ctrl.createPortfolio));
router.put("/portfolios/:id", wrap(ctrl.updatePortfolio));
router.delete("/portfolios/:id", wrap(ctrl.deletePortfolio));

router.get("/properties", wrap(ctrl.listProperties));
router.post("/properties", wrap(ctrl.createProperty));
router.put("/properties/:id", wrap(ctrl.updateProperty));
router.delete("/properties/:id", wrap(ctrl.deleteProperty));

router.get("/company-settings", wrap(ctrl.getCompanySettings));
router.put("/company-settings", wrap(ctrl.putCompanySettings));
router.get("/unit-detail-columns", wrap(ctrl.getUnitDetailColumnPrefs));
router.put("/unit-detail-columns", wrap(ctrl.putUnitDetailColumnPrefs));
router.get("/collection-settings", wrap(ctrl.getCompanySettings));
router.put("/collection-settings", wrap(ctrl.putCompanySettings));
router.get("/property-list-names", wrap(ctrl.listPropertyListNames));

module.exports = router;
