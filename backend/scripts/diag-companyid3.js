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

async function dvFetch(path, query) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const base = `${String(environmentUrl).replace(/\/+$/, "")}/api/data/v9.2`;
  const q = query ? (path.includes("?") ? `&${query}` : `?${query}`) : "";
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}${q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      Prefer: 'odata.include-annotations="*"'
    }
  });
  const text = await res.text();
  console.log("\n---", path.slice(0, 60), res.status);
  if (!res.ok) {
    console.log(text.slice(0, 400));
    return null;
  }
  return JSON.parse(text);
}

async function main() {
  const ln = "cr668_montiumrr";
  const set = "cr668_montiumrrs";

  const attrs = await dvFetch(
    `/EntityDefinitions(LogicalName='${ln}')/Attributes`,
    "$select=LogicalName,AttributeType,DisplayName,SchemaName&$filter=contains(LogicalName,'company') or contains(SchemaName,'company')"
  );
  console.log("Attributes with 'company':");
  for (const a of attrs?.value || []) {
    console.log(
      `  ${a.LogicalName} (${a.AttributeType}) schema=${a.SchemaName} display=${a.DisplayName?.UserLocalizedLabel?.Label}`
    );
  }

  const filters = [
    "cr668_companyid eq 3",
    "cr668_companyid ge 3 and cr668_companyid lt 4",
    "Microsoft.Dynamics.CRM.EqualUserDefined: cr668_companyid eq 3"
  ];

  for (const f of filters) {
    const json = await dvFetch(`/${set}`, `$filter=${encodeURIComponent(f)}&$count=true&$top=1`);
    console.log(`Filter [${f}] => count=${json?.["@odata.count"] ?? "?"}`);
  }

  // Unfiltered sample: look for any key containing company
  const sample = await dvFetch(`/${set}`, "$top=5");
  if (sample?.value?.[0]) {
    console.log("\nAll company-related keys on first row:");
    for (const [k, v] of Object.entries(sample.value[0])) {
      if (/company/i.test(k)) console.log(`  ${k}:`, v);
    }
  }

  // Scan formatted values for 3
  let fmt3 = 0;
  let raw3 = 0;
  let total = 0;
  for await (const { record } of dataverseApi.iterateRecords(creds, ln, set, 500, {
    companyId: null,
    mappingConfig: { sourceCompanyFilter: { enabled: false } }
  })) {
    total++;
    const raw = record.cr668_companyid;
    if (raw == 3 || Number(raw) === 3) raw3++;
    if (total <= 3) console.log("\nSample record company fields:", record);
    if (total >= 5000) break;
  }
  console.log(`\nScan ${total} rows: raw cr668_companyid=3: ${raw3}`);

  const scope = await dataverseApi.buildCompanyScope(creds, ln, 3, null);
  console.log("\nbuildCompanyScope(3):", scope);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
