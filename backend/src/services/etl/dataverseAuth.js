"use strict";

/**
 * OAuth2 client credentials for Dataverse / Dynamics 365.
 * @param {{ tenantId: string, clientId: string, clientSecret: string, environmentUrl: string }} cfg
 */
async function getDataverseAccessToken(cfg) {
  const tenantId = String(cfg.tenantId || "").trim();
  const clientId = String(cfg.clientId || "").trim();
  const clientSecret = String(cfg.clientSecret || "").trim();
  let base = String(cfg.environmentUrl || "").trim().replace(/\/+$/, "");
  if (!tenantId || !clientId || !clientSecret || !base) {
    const e = new Error("tenantId, clientId, clientSecret, and environmentUrl are required");
    e.code = "BAD_CONFIG";
    throw e;
  }
  if (!/^https:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  const scope = `${base}/.default`;
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error_description || json.error || res.statusText || "Token request failed";
    const e = new Error(String(msg));
    e.code = "DV_AUTH";
    throw e;
  }
  if (!json.access_token) {
    const e = new Error("No access_token in token response");
    e.code = "DV_AUTH";
    throw e;
  }
  return { accessToken: json.access_token, environmentUrl: base, scope };
}

module.exports = { getDataverseAccessToken };
