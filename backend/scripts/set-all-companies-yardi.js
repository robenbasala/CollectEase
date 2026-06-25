"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { query } = require("../src/db");

async function main() {
  await query(`UPDATE dbo.Companies SET DataSource = N'Yardi'`);
  const result = await query(`SELECT Id, Name, DataSource FROM dbo.Companies ORDER BY Name`);
  console.log(JSON.stringify(result.recordset, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
