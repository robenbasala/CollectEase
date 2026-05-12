const express = require("express");
const ctrl = require("../controllers/admin.controller");
const { requireCompanyAdmin } = require("../middleware/firebaseAuth");

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/reminder-email-log", wrap(ctrl.listReminderEmailLog));
router.post("/reminder-email-log", wrap(ctrl.postReminderEmailLog));

router.get("/company-settings", wrap(ctrl.getCompanySettings));
router.get("/unit-detail-columns", wrap(ctrl.getUnitDetailColumnPrefs));
router.get("/collection-settings", wrap(ctrl.getCompanySettings));

router.use(requireCompanyAdmin);

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

router.get("/legal-status-preset-lists", wrap(ctrl.listLegalStatusPresetLists));
router.post("/legal-status-preset-lists", wrap(ctrl.createLegalStatusPresetList));
router.put("/legal-status-preset-lists/:listId", wrap(ctrl.updateLegalStatusPresetList));
router.delete("/legal-status-preset-lists/:listId", wrap(ctrl.deleteLegalStatusPresetList));
router.get("/legal-status-preset-lists/:listId/options", wrap(ctrl.listLegalStatusPresetOptions));
router.post("/legal-status-preset-lists/:listId/options", wrap(ctrl.createLegalStatusPresetOption));
router.put("/legal-status-preset-lists/:listId/options/:id", wrap(ctrl.updateLegalStatusPresetOption));
router.delete("/legal-status-preset-lists/:listId/options/:id", wrap(ctrl.deleteLegalStatusPresetOption));

router.put("/company-settings", wrap(ctrl.putCompanySettings));
router.put("/unit-detail-columns", wrap(ctrl.putUnitDetailColumnPrefs));
router.put("/collection-settings", wrap(ctrl.putCompanySettings));
router.get("/property-list-names", wrap(ctrl.listPropertyListNames));

module.exports = router;
