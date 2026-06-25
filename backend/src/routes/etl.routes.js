"use strict";

const express = require("express");
const { requireCompanyAdmin } = require("../middleware/firebaseAuth");
const ctrl = require("../controllers/etlDataverse.controller");

const router = express.Router();

function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

router.use(requireCompanyAdmin);

router.get("/etl/dataverse/connection-defaults", wrap(ctrl.getConnectionDefaults));
router.post("/etl/dataverse/connections/test", wrap(ctrl.testConnection));

router.get("/etl/dataverse/connections", wrap(ctrl.listConnections));
router.post("/etl/dataverse/connections", wrap(ctrl.createConnection));
router.put("/etl/dataverse/connections/:id", wrap(ctrl.updateConnection));
router.delete("/etl/dataverse/connections/:id", wrap(ctrl.deleteConnection));

router.get("/etl/dataverse/connections/:id/tables", wrap(ctrl.listTables));
router.get("/etl/dataverse/connections/:id/tables/:tableLogicalName/columns", wrap(ctrl.getTableColumns));
router.get("/etl/dataverse/connections/:id/tables/:tableLogicalName/preview", wrap(ctrl.previewTable));

router.get("/etl/sql/datatbl/columns", wrap(ctrl.getDataTblColumns));

router.get("/etl/dataverse/mappings", wrap(ctrl.listMappings));
router.get("/etl/dataverse/mappings/:id", wrap(ctrl.getMapping));
router.get("/etl/dataverse/mappings/:id/logs", wrap(ctrl.listMappingImportLogs));
router.post("/etl/dataverse/mappings", wrap(ctrl.createMapping));
router.put("/etl/dataverse/mappings/:id", wrap(ctrl.updateMapping));
router.delete("/etl/dataverse/mappings/:id", wrap(ctrl.deleteMapping));
router.post("/etl/dataverse/mappings/auto-map", wrap(ctrl.autoMap));

router.post("/etl/dataverse/import/preview", wrap(ctrl.importPreview));
router.post("/etl/dataverse/import/run", wrap(ctrl.runImport));
router.get("/etl/dataverse/import/logs", wrap(ctrl.listImportLogs));
router.get("/etl/dataverse/import/logs/:id", wrap(ctrl.getImportLog));

module.exports = router;
