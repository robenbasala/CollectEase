"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { getDataverseAccessToken } = require("../src/services/etl/dataverseAuth");

(async () => {
  const creds = {
    tenantId: process.env.DATAVERSE_TENANT_ID,
    clientId: process.env.DATAVERSE_CLIENT_ID,
    clientSecret: process.env.DATAVERSE_CLIENT_SECRET,
    environmentUrl: process.env.DATAVERSE_ENVIRONMENT_URL
  };
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const base = `${environmentUrl.replace(/\/+$/, "")}/api/data/v9.2`;
  for (const unit of ["5605-14", "3806-104", "3808-303"]) {
    const f = encodeURIComponent(`cr668_unit eq '${unit}'`);
    const r = await fetch(`${base}/cr668_montiumrrs?$filter=${f}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        Prefer: 'odata.include-annotations="*"'
      }
    });
    const j = await r.json();
    const row = j.value?.[0];
    console.log(unit, "=>", row ? { companyid: row.cr668_companyid, fmt: row["cr668_companyid@OData.Community.Display.V1.FormattedValue"], property: row.cr668_propertyname } : "NOT FOUND");
  }
})();
