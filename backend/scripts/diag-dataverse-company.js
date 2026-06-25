"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { getDataverseAccessToken } = require("../src/services/etl/dataverseAuth");
const dataverseApi = require("../src/services/etl/dataverseApi");

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

  const attrUrl = `${base}/EntityDefinitions(LogicalName='${ln}')/Attributes?$select=LogicalName,AttributeType,DisplayName,SchemaName,IsCustomAttribute&$filter=contains(LogicalName,'company')`;
  const attrRes = await fetch(attrUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const attrs = (await attrRes.json()).value || [];
  console.log("Company-related attributes:");
  for (const r of attrs) {
    console.log(
      `  ${r.LogicalName} (${r.AttributeType}) display=${r.DisplayName?.UserLocalizedLabel?.Label} custom=${r.IsCustomAttribute}`
    );
  }

  const rowUrl = `${base}/cr668_montiumrrs?$top=5&$filter=cr668_companyid eq 1`;
  const rowRes = await fetch(rowUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      Prefer: 'odata.include-annotations="*"'
    }
  });
  const rows = (await rowRes.json()).value || [];
  if (rows[0]) {
    console.log("\nSample row company-related raw fields:");
    for (const [k, v] of Object.entries(rows[0])) {
      if (/company/i.test(k)) console.log(`  ${k}:`, v);
    }
  }

  console.log("\nCollectEase company id -> Dataverse cr668_companyid counts:");
  for (const cid of [1, 2, 3, 4, 5]) {
    const scope = await dataverseApi.buildCompanyScope(creds, ln, cid, null);
    let count = 0;
    for await (const _ of dataverseApi.iterateRecords(creds, ln, "cr668_montiumrrs", 500, {
      companyId: cid
    })) {
      count += 1;
    }
    const cntApi = await dataverseApi
      .countRecords(creds, ln, "cr668_montiumrrs", { filter: scope.filter })
      .catch((e) => `ERR: ${e.message}`);
    console.log(
      `  CollectEase companyId ${cid}: iterate=${count} countApi=${cntApi} (filter: ${scope.filter || "none"})`
    );
  }

  const dist = await dataverseApi.summarizeCompanyIdDistribution(
    creds,
    ln,
    "cr668_montiumrrs",
    "cr668_companyid"
  );
  console.log("\nDistribution:", dist);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
