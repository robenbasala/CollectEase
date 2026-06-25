"use strict";

require("dotenv").config();

function trim(v) {
  return v == null ? "" : String(v).trim();
}

/** @returns {{ tenantId: string, clientId: string, clientSecret: string, environmentUrl: string } | null} */
function getDataverseEnvCreds() {
  const tenantId = trim(process.env.DATAVERSE_TENANT_ID);
  const clientId = trim(process.env.DATAVERSE_CLIENT_ID);
  const clientSecret = trim(process.env.DATAVERSE_CLIENT_SECRET);
  const environmentUrl = trim(process.env.DATAVERSE_ENVIRONMENT_URL);
  if (!tenantId && !clientId && !clientSecret && !environmentUrl) return null;
  return { tenantId, clientId, clientSecret, environmentUrl };
}

function isEnvCredsComplete(creds) {
  return Boolean(creds?.tenantId && creds?.clientId && creds?.clientSecret && creds?.environmentUrl);
}

/** Merge request body with server .env defaults (body wins when set). */
function mergeCredsWithEnv(body = {}) {
  const env = getDataverseEnvCreds() || {};
  return {
    tenantId: trim(body.tenantId) || env.tenantId || "",
    clientId: trim(body.clientId) || env.clientId || "",
    clientSecret: trim(body.clientSecret) || env.clientSecret || "",
    environmentUrl: trim(body.environmentUrl) || env.environmentUrl || ""
  };
}

/** Safe fields for the admin UI (no secret). */
function getDataverseConnectionDefaults() {
  const env = getDataverseEnvCreds() || {};
  const name = trim(process.env.DATAVERSE_CONNECTION_NAME) || "CollectEase360";
  return {
    name,
    environmentUrl: env.environmentUrl || "",
    tenantId: env.tenantId || "",
    clientId: env.clientId || "",
    hasEnvSecret: Boolean(env.clientSecret),
    envConfigured: isEnvCredsComplete(env)
  };
}

module.exports = {
  getDataverseEnvCreds,
  mergeCredsWithEnv,
  getDataverseConnectionDefaults,
  isEnvCredsComplete
};
