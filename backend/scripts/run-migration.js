#!/usr/bin/env node
/**
 * Tiny ad-hoc runner: executes a single .sql file against the configured DB.
 * Usage: node scripts/run-migration.js <path-to.sql>
 * Splits on lines that are exactly "GO" (T-SQL batch separator) since mssql cannot handle them in one query.
 */
const path = require("path");
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  // eslint-disable-next-line no-console
  console.error("Usage: node scripts/run-migration.js <path-to.sql>");
  process.exit(2);
}

const resolved = path.resolve(file);
if (!fs.existsSync(resolved)) {
  // eslint-disable-next-line no-console
  console.error(`Not found: ${resolved}`);
  process.exit(2);
}

const sqlText = fs.readFileSync(resolved, "utf8");
/** Split on a line containing only GO (case-insensitive). */
const batches = sqlText
  .split(/^\s*GO\s*$/im)
  .map((b) => b.trim())
  .filter((b) => b.length > 0);

(async () => {
  const { getPool } = require("../src/db");
  const pool = await getPool();
  for (const [i, batch] of batches.entries()) {
    // eslint-disable-next-line no-console
    console.log(`-- batch ${i + 1}/${batches.length}`);
    await pool.request().batch(batch);
  }
  // eslint-disable-next-line no-console
  console.log(`OK — applied ${path.basename(resolved)} (${batches.length} batch(es)).`);
  await pool.close();
  process.exit(0);
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", e.message || e);
  process.exit(1);
});
