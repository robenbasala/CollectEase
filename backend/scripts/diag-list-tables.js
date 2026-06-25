"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { getDataverseAccessToken } = require("../src/services/etl/dataverseAuth");

async function main() {
  const creds = {
    tenantId: process.env.DATAVERSE_TENANT_ID,
    clientId: process.env.DATAVERSE_CLIENT_ID,
    clientSecret: process.env.DATAVERSE_CLIENT_SECRET,
    environmentUrl: process.env.DATAVERSE_ENVIRONMENT_URL
  };
  console.log("URL:", creds.environmentUrl);
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/v9.2`;

  const filters = [
    "IsCustomEntity eq true and IsManaged eq false",
    "IsCustomEntity eq true",
    "IsCustomizable eq true",
    null
  ];

  for (const f of filters) {
    let url = `${base}/EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName`;
    if (f) url += `&$filter=${encodeURIComponent(f)}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
      }
    });
    const text = await r.text();
    console.log("\nfilter:", f || "(none)", "status:", r.status);
    if (!r.ok) {
      console.log(text.slice(0, 400));
      continue;
    }
    const j = JSON.parse(text);
    console.log("  rows:", j.value?.length);
    for (const row of j.value || []) {
      console.log("   ", row.LogicalName, "managed:", row.IsManaged, "custom:", row.IsCustomEntity);
    }
  }

  const r2 = await fetch(`${base}/cr668_montiumrrs?$top=1&$count=true`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0"
    }
  });
  console.log("\ncr668_montiumrrs direct:", r2.status);
  console.log((await r2.text()).slice(0, 300));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
