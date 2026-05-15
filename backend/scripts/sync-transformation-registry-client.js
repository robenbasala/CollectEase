"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const srcPath = path.join(root, "shared", "transformationOpsRegistry.cjs");
const destPath = path.join(root, "frontend", "src", "lib", "transformationOpsRegistryClient.js");

let src = fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");
src = src.replace(/^"use strict";\s*\n/m, "");
src = src.replace(/\nmodule\.exports = \{[\s\S]*\};\s*$/, "\n");

const banner = `/**
 * Browser/Vite ESM copy of the transformation registry.
 * Node source of truth: shared/transformationOpsRegistry.cjs
 * Regenerate: node backend/scripts/sync-transformation-registry-client.js
 */

`;

const footer = `
export {
  TRANSFORMATION_OPS,
  EXPR_HELPER_FUNCTIONS,
  SUPPORTED_OP_LIST,
  canonicalOpName,
  normalizeStep,
  validateParsedPipeline,
  validatePipelineText,
  formatDiagList,
  summarizeValidation,
  buildExprColumnHints,
  buildCollectionReportCleanupPipeline,
  buildBasicCleanupPipeline,
  buildRemoveBlankRowsPipeline,
  buildRemoveHeaderRowPipeline,
  sanitizeExprIdentForExport
};
`;

fs.writeFileSync(destPath, banner + src + footer, "utf8");
console.log("Wrote", destPath);
