"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { getDataverseAccessToken } = require("../src/services/etl/dataverseAuth");

const creds = {
  tenantId: process.env.DATAVERSE_TENANT_ID,
  clientId: process.env.DATAVERSE_CLIENT_ID,
  clientSecret: process.env.DATAVERSE_CLIENT_SECRET,
  environmentUrl: process.env.DATAVERSE_ENVIRONMENT_URL
};

async function main() {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const base = `${String(environmentUrl).replace(/\/+$/, "")}/api/data/v9.2`;
  const ln = "cr668_montiumrr";

  let url = `${base}/EntityDefinitions(LogicalName='${ln}')/Attributes?$select=LogicalName,AttributeType,DisplayName,SchemaName,IsCustomAttribute`;
  const companyCols = [];
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
    const json = await res.json();
    for (const a of json.value || []) {
      const disp = a.DisplayName?.UserLocalizedLabel?.Label || "";
      if (/company/i.test(a.LogicalName) || /company/i.test(a.SchemaName || "") || /company/i.test(disp)) {
        companyCols.push({
          logical: a.LogicalName,
          type: a.AttributeType,
          schema: a.SchemaName,
          display: disp,
          custom: a.IsCustomAttribute
        });
      }
    }
    url = json["@odata.nextLink"] || null;
  }
  console.log("Company-related attributes on cr668_montiumrr:");
  console.log(companyCols);

  // Try alternate logical table names
  const tablesRes = await fetch(
    `${base}/EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName&$filter=IsCustomEntity eq true and IsManaged eq false`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
  );
  const tables = (await tablesRes.json()).value || [];
  const montium = tables.filter((t) => /montium/i.test(t.LogicalName) || /montium/i.test(t.DisplayName?.UserLocalizedLabel?.Label || ""));
  console.log("\nMontium tables:", montium.map((t) => ({ ln: t.LogicalName, set: t.EntitySetName, disp: t.DisplayName?.UserLocalizedLabel?.Label })));

  // Count by statecode - maybe inactive rows?
  for (const f of ["statecode eq 0", "statecode eq 1"]) {
    const r = await fetch(`${base}/cr668_montiumrrs?$filter=${encodeURIComponent(f)}&$count=true&$top=0`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
    const j = await r.json();
    console.log(`statecode filter ${f}: ${j["@odata.count"]}`);
  }
}

main().catch(console.error);
