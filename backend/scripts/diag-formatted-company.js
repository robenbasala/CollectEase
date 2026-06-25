"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { getDataverseAccessToken } = require("../src/services/etl/dataverseAuth");

const creds = {
  tenantId: process.env.DATAVERSE_TENANT_ID,
  clientId: process.env.DATAVERSE_CLIENT_ID,
  clientSecret: process.env.DATAVERSE_CLIENT_SECRET,
  environmentUrl: process.env.DATAVERSE_ENVIRONMENT_URL
};

const FMT = "@OData.Community.Display.V1.FormattedValue";

async function main() {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const base = `${String(environmentUrl).replace(/\/+$/, "")}/api/data/v9.2`;
  let url = `${base}/cr668_montiumrrs?$top=500&$orderby=cr668_montiumrrid asc`;
  const counts = { plain: new Map(), formatted: new Map() };
  let pages = 0;

  while (url && pages < 20) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        Prefer: 'odata.include-annotations="*"'
      }
    });
    const json = await res.json();
    for (const row of json.value || []) {
      const plain = row.cr668_companyid;
      const fmt = row[`cr668_companyid${FMT}`];
      const pk = plain == null ? "null" : String(plain);
      const fk = fmt == null ? "null" : String(fmt);
      counts.plain.set(pk, (counts.plain.get(pk) || 0) + 1);
      counts.formatted.set(fk, (counts.formatted.get(fk) || 0) + 1);
      if (fmt === "3.00" || fmt === "3" || plain === 3) {
        console.log("FOUND 3:", { plain, fmt, unit: row.cr668_unit, id: row.cr668_montiumrrid });
      }
    }
    url = json["@odata.nextLink"] || null;
    pages++;
  }

  console.log("\nPlain cr668_companyid distribution (sampled pages):");
  console.log([...counts.plain.entries()].sort((a, b) => b[1] - a[1]));
  console.log("\nFormatted distribution:");
  console.log([...counts.formatted.entries()].sort((a, b) => b[1] - a[1]));
}

main().catch(console.error);
