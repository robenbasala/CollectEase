"use strict";

const { getDataverseAccessToken } = require("./dataverseAuth");
const { parseNumericValue, extractODataPrimitive } = require("./etlValueTransform");

function apiBase(environmentUrl) {
  return `${String(environmentUrl).replace(/\/+$/, "")}/api/data/v9.2`;
}

const DV_PREFER = 'odata.include-annotations="*",odata.maxpagesize=75';

async function dvFetch(environmentUrl, accessToken, path, query, prefer = DV_PREFER) {
  const q = query ? (path.includes("?") ? `&${query.replace(/^\?/, "")}` : `?${query}`) : "";
  const url = `${apiBase(environmentUrl)}${path.startsWith("/") ? path : `/${path}`}${q}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: prefer
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.error?.innererror?.message ||
      text?.slice(0, 500) ||
      res.statusText;
    const e = new Error(String(msg));
    e.code = "DV_API";
    e.status = res.status;
    throw e;
  }
  return json;
}

async function dvFetchAbsolute(accessToken, absoluteUrl, prefer = DV_PREFER) {
  const res = await fetch(String(absoluteUrl), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: prefer
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.error?.innererror?.message ||
      text?.slice(0, 500) ||
      res.statusText;
    const e = new Error(String(msg));
    e.code = "DV_API";
    e.status = res.status;
    throw e;
  }
  return json;
}

/**
 * @param {{ tenantId, clientId, clientSecret, environmentUrl }} creds
 */
async function testConnection(creds) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  try {
    await dvFetch(environmentUrl, accessToken, "/WhoAmI");
  } catch (err) {
    const msg = String(err?.message || "");
    if (/not a member of the organization/i.test(msg)) {
      const e = new Error(
        "Azure sign-in succeeded but this app is not an Application User in the Dataverse environment. " +
          "In Power Platform admin center → your environment → Settings → Users → Application users: " +
          "add app CollectEase360 (client id from Azure) and assign a security role (e.g. System Administrator or custom)."
      );
      e.code = "DV_API";
      e.status = 403;
      throw e;
    }
    throw err;
  }
  return { ok: true, environmentUrl };
}

/** @param {string} filter OData $filter for EntityDefinitions */
async function fetchEntityDefinitionTables(accessToken, environmentUrl, filter) {
  const tables = [];
  let path = `/EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName&$filter=${encodeURIComponent(filter)}`;
  while (path) {
    const json = path.startsWith("http")
      ? await fetch(path, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0"
          }
        }).then(async (r) => {
          if (!r.ok) throw new Error(r.statusText);
          return r.json();
        })
      : await dvFetch(environmentUrl, accessToken, path);
    for (const row of json?.value || []) {
      const logicalName = String(row.LogicalName || "").trim();
      if (!logicalName) continue;
      tables.push({
        logicalName,
        entitySetName: String(row.EntitySetName || "").trim() || null,
        displayName:
          row.DisplayName?.UserLocalizedLabel?.Label ||
          row.DisplayName?.LocalizedLabels?.[0]?.Label ||
          logicalName
      });
    }
    const next = json?.["@odata.nextLink"];
    path = next || null;
  }
  return tables;
}

/**
 * @param {{ tenantId, clientId, clientSecret, environmentUrl }} creds
 */
async function listTables(creds) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  // Prefer unmanaged custom tables (dev environments). Production solutions are often managed.
  let tables = await fetchEntityDefinitionTables(
    accessToken,
    environmentUrl,
    "IsCustomEntity eq true and IsManaged eq false"
  );
  if (tables.length === 0) {
    tables = await fetchEntityDefinitionTables(accessToken, environmentUrl, "IsCustomEntity eq true");
  }
  tables.sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  return tables;
}

/** Standard Dataverse / CRM system attribute logical names (no publisher prefix). */
const STANDARD_DV_ATTRIBUTE_NAMES = new Set([
  "createdon",
  "modifiedon",
  "createdby",
  "modifiedby",
  "createdonbehalfby",
  "modifiedonbehalfby",
  "ownerid",
  "owningbusinessunit",
  "owninguser",
  "owningteam",
  "statecode",
  "statuscode",
  "versionnumber",
  "importsequencenumber",
  "overriddencreatedon",
  "timezoneruleversionnumber",
  "utcconversiontimezonecode",
  "exchangerate",
  "transactioncurrencyid",
  "organizationid",
  "processid",
  "stageid",
  "traversedpath"
]);

/**
 * True for publisher custom columns (e.g. cr668_balance), not out-of-box system fields.
 */
function isCustomDataverseColumn(logicalName, entityLogicalName) {
  const k = String(logicalName || "").trim();
  if (!k || k.startsWith("_") || k.includes("@")) return false;
  const lc = k.toLowerCase();
  if (STANDARD_DV_ATTRIBUTE_NAMES.has(lc)) return false;
  // Primary key on custom table (needed for import; treated as custom entity field)
  const ln = String(entityLogicalName || "").trim().toLowerCase();
  if (ln && lc === `${ln}id`) return true;
  // Dynamics publisher prefix: crXXX_…
  if (/^cr[0-9a-f]{3,5}_/i.test(k)) return true;
  // Legacy custom prefix
  if (/^new_/i.test(lc)) return true;
  return false;
}

function mapAttributeType(attr) {
  const t = String(attr.AttributeType || attr.Type || "").toLowerCase();
  if (t.includes("string") || t === "memo") return "string";
  if (t.includes("int")) return "integer";
  if (t.includes("decimal") || t.includes("double") || t.includes("money")) return "number";
  if (t.includes("bool")) return "boolean";
  if (t.includes("date") || t.includes("time")) return "datetime";
  if (t.includes("uniqueidentifier")) return "guid";
  return t || "unknown";
}

/**
 * @param {{ tenantId, clientId, clientSecret, environmentUrl }} creds
 * @param {string} logicalName
 */
async function getTableColumns(creds, logicalName) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const ln = String(logicalName || "").trim();
  const path = `/EntityDefinitions(LogicalName='${ln.replace(/'/g, "''")}')/Attributes`;
  let json;
  try {
    json = await dvFetch(
      environmentUrl,
      accessToken,
      path,
      "$select=LogicalName,AttributeType,DisplayName,RequiredLevel,SchemaName,IsCustomAttribute&$filter=IsValidODataAttribute eq true and IsCustomAttribute eq true"
    );
  } catch {
    json = await dvFetch(
      environmentUrl,
      accessToken,
      path,
      "$select=LogicalName,AttributeType,DisplayName,RequiredLevel,SchemaName,IsCustomAttribute&$filter=IsValidODataAttribute eq true"
    );
  }
  const cols = [];
  for (const row of json?.value || []) {
    const name = String(row.LogicalName || "").trim();
    if (!name) continue;
    const isCustom =
      row.IsCustomAttribute === true ||
      row.IsCustomAttribute === "true" ||
      isCustomDataverseColumn(name, ln);
    if (!isCustom) continue;
    cols.push({
      logicalName: name,
      schemaName: row.SchemaName || name,
      displayName:
        row.DisplayName?.UserLocalizedLabel?.Label ||
        row.DisplayName?.LocalizedLabels?.[0]?.Label ||
        name,
      dataType: mapAttributeType(row),
      maxLength: null,
      required: String(row.RequiredLevel?.Value || row.RequiredLevel || "").toLowerCase() === "required"
    });
  }
  cols.sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  return cols;
}

function filterRowToCustomColumns(row, allowedColumns, entityLogicalName) {
  const allow =
    allowedColumns instanceof Set
      ? allowedColumns
      : new Set(
          (allowedColumns || []).map((c) =>
            typeof c === "string" ? c : c.logicalName || c.name || ""
          )
        );
  if (!allow.size) {
    const out = {};
    for (const [k, v] of Object.entries(row || {})) {
      if (isCustomDataverseColumn(k, entityLogicalName)) out[k] = v;
    }
    return out;
  }
  const out = {};
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  }
  return out;
}

/**
 * Resolve entity set name for OData collection.
 */
async function resolveEntitySetName(creds, logicalName, entitySetHint) {
  if (entitySetHint) return String(entitySetHint).trim();
  const ln = String(logicalName || "").trim().replace(/'/g, "''");
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const json = await dvFetch(
    environmentUrl,
    accessToken,
    `/EntityDefinitions(LogicalName='${ln}')`,
    "$select=EntitySetName,LogicalName"
  );
  const set = String(json?.EntitySetName || "").trim();
  if (set) return set;
  return logicalName;
}

/**
 * @param {{ tenantId, clientId, clientSecret, environmentUrl }} creds
 * @param {string} logicalName
 * @param {string|null} entitySetName
 * @param {number} top
 */
const FORMATTED_SUFFIX = "@OData.Community.Display.V1.FormattedValue";

async function countRecords(creds, logicalName, entitySetName, options = {}) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const set = await resolveEntitySetName(creds, logicalName, entitySetName);
  const filter = options.filter ? String(options.filter).trim() : "";
  const query = filter
    ? `$filter=${encodeURIComponent(filter)}&$count=true&$top=1`
    : "$count=true&$top=1";
  const json = await dvFetch(environmentUrl, accessToken, `/${set}`, query);
  const n = Number(json?.["@odata.count"]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Count rows per value in the source company column (for ETL diagnostics).
 */
async function summarizeCompanyIdDistribution(creds, logicalName, entitySetName, companyColumn) {
  const col = String(companyColumn || "").trim();
  if (!col) return { total: 0, values: [] };
  const counts = new Map();
  let total = 0;
  for await (const { record } of iterateRecords(creds, logicalName, entitySetName, 500, {
    companyId: null,
    mappingConfig: { sourceCompanyFilter: { enabled: false } }
  })) {
    total += 1;
    const raw = record[col];
    const key = raw == null || raw === "" ? "null" : String(Math.trunc(Number(raw)) || raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  return { total, column: col, values };
}

function primaryKeyAttribute(logicalName) {
  const ln = String(logicalName || "").trim();
  if (!ln) return null;
  return `${ln}id`;
}

function odataFilterAfterPk(pkAttr, afterId) {
  const id = String(afterId || "").trim();
  if (!id) return "";
  const esc = id.replace(/'/g, "''");
  return `${pkAttr} gt ${esc}`;
}

function combineODataFilters(...parts) {
  const clauses = parts.map((p) => String(p || "").trim()).filter(Boolean);
  if (!clauses.length) return "";
  return clauses.join(" and ");
}

/**
 * OData $filter for tenant company id on a Dataverse custom column.
 */
function buildCompanyIdODataFilter(columnLogicalName, companyId, dataType) {
  const col = String(columnLogicalName || "").trim();
  if (!col || companyId == null || String(companyId).trim() === "") return "";
  const n = Number(companyId);
  if (!Number.isFinite(n)) return "";
  const dt = String(dataType || "").toLowerCase();
  const low = Math.trunc(n);
  // Range filter matches Integer and Decimal (3, 3.0, 3.00) reliably in Dataverse OData.
  if (
    !dt ||
    dt.includes("int") ||
    dt.includes("decimal") ||
    dt.includes("number") ||
    dt.includes("double") ||
    dt.includes("money") ||
    dt === "unknown"
  ) {
    return `${col} ge ${low} and ${col} lt ${low + 1}`;
  }
  const esc = String(companyId).replace(/'/g, "''");
  return `${col} eq '${esc}'`;
}

function scoreCompanyIdColumn(c) {
  const ln = String(c.logicalName || c.name || "").toLowerCase();
  const disp = String(c.displayName || "")
    .replace(/\s/g, "")
    .toLowerCase();
  const schema = String(c.schemaName || "").toLowerCase();
  if (disp === "companyid") return 0;
  if (schema === "companyid" || schema.endsWith("_companyid")) return 1;
  if (/^cr[0-9a-f]+_companyid$/i.test(ln)) return 2 + ln.length * 0.001;
  if (ln.endsWith("_companyid")) return 10 + ln.length * 0.001;
  if (ln.includes("collecteasecompanyid")) return 20;
  if (ln === "companyid") return 5;
  return 50;
}

function findCompanyIdColumnInMeta(columns) {
  const candidates = (columns || []).filter((c) => {
    const ln = String(c.logicalName || c.name || "").trim();
    if (!ln) return false;
    const lc = ln.toLowerCase();
    const disp = String(c.displayName || "")
      .replace(/\s/g, "")
      .toLowerCase();
    const schema = String(c.schemaName || "").toLowerCase();
    return (
      lc === "companyid" ||
      lc.endsWith("_companyid") ||
      lc.includes("collecteasecompanyid") ||
      disp === "companyid" ||
      schema.endsWith("companyid")
    );
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => scoreCompanyIdColumn(a) - scoreCompanyIdColumn(b));
  return candidates[0];
}

/**
 * Read source company filter settings from mapping JSON.
 * @returns {{ enabled: boolean, sourceValue: number|null, useWorkspaceId: boolean }}
 */
function parseSourceCompanyFilterConfig(mappingConfig) {
  const cfg = mappingConfig?.sourceCompanyFilter || {};
  const enabled = cfg.enabled !== false;
  const useWorkspaceId = cfg.useWorkspaceId !== false;
  let sourceValue = null;
  if (cfg.sourceValue != null && String(cfg.sourceValue).trim() !== "") {
    const n = Number(cfg.sourceValue);
    if (Number.isFinite(n)) sourceValue = Math.trunc(n);
  }
  return { enabled, sourceValue, useWorkspaceId };
}

/**
 * Value used in OData $filter on the Dataverse company column (null = no filter).
 */
function resolveSourceCompanyFilterValue(companyId, mappingConfig) {
  const cfg = parseSourceCompanyFilterConfig(mappingConfig);
  if (!cfg.enabled) return null;
  if (cfg.sourceValue != null) return cfg.sourceValue;
  if (!cfg.useWorkspaceId) return null;
  const n = Number(companyId);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function recordMatchesCompanyId(record, companyColumn, companyId, { serverFiltered = false } = {}) {
  if (companyId == null || !companyColumn) return true;
  const raw = record?.[companyColumn];
  if (raw == null || raw === "") {
    // OData $filter already scoped rows; company column may be omitted from custom-field projection.
    return serverFiltered ? true : false;
  }
  const want = Number(companyId);
  const got = Number(raw);
  if (Number.isFinite(want) && Number.isFinite(got)) return Math.trunc(got) === Math.trunc(want);
  return String(raw).trim() === String(companyId).trim();
}

function passesCompanyScope(record, scope, filterValue) {
  if (filterValue == null || !scope?.column) return true;
  return recordMatchesCompanyId(record, scope.column, filterValue, {
    serverFiltered: Boolean(scope.filter)
  });
}

function companyIdFromMappingConfig(mappingConfig) {
  for (const m of mappingConfig?.columnMappings || []) {
    const dest = String(m.destinationColumn || "").trim();
    const src = String(m.sourceColumn || "").trim();
    if (dest.toLowerCase() === "companyid" && src) {
      return { logicalName: src, dataType: "integer" };
    }
  }
  return null;
}

async function getAllTableColumns(creds, logicalName) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const ln = String(logicalName || "").trim();
  const path = `/EntityDefinitions(LogicalName='${ln.replace(/'/g, "''")}')/Attributes`;
  const json = await dvFetch(
    environmentUrl,
    accessToken,
    path,
    "$select=LogicalName,AttributeType,DisplayName,RequiredLevel,SchemaName,IsCustomAttribute&$filter=IsValidODataAttribute eq true"
  );
  const cols = [];
  for (const row of json?.value || []) {
    const name = String(row.LogicalName || "").trim();
    if (!name) continue;
    cols.push({
      logicalName: name,
      schemaName: row.SchemaName || name,
      displayName:
        row.DisplayName?.UserLocalizedLabel?.Label ||
        row.DisplayName?.LocalizedLabels?.[0]?.Label ||
        name,
      dataType: mapAttributeType(row),
      maxLength: null,
      required: String(row.RequiredLevel?.Value || row.RequiredLevel || "").toLowerCase() === "required"
    });
  }
  cols.sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  return cols;
}

/**
 * Resolve Dataverse source column used for tenant filtering.
 * @param {{ tenantId, clientId, clientSecret, environmentUrl }} creds
 * @param {string} logicalName
 * @param {{ columnMappings?: object[] }|null} mappingConfig
 */
async function resolveCompanyIdSourceColumn(creds, logicalName, mappingConfig) {
  const fromMap = companyIdFromMappingConfig(mappingConfig);
  if (fromMap) return fromMap;
  try {
    let cols = await getTableColumns(creds, logicalName);
    let found = findCompanyIdColumnInMeta(cols);
    if (found) return found;
    cols = await getAllTableColumns(creds, logicalName);
    return findCompanyIdColumnInMeta(cols);
  } catch {
    return null;
  }
}

async function buildCompanyScope(creds, logicalName, companyId, mappingConfig) {
  const filterCfg = parseSourceCompanyFilterConfig(mappingConfig);
  const filterValue = resolveSourceCompanyFilterValue(companyId, mappingConfig);
  if (filterValue == null) {
    return {
      column: null,
      filter: "",
      dataType: null,
      filterValue: null,
      filterEnabled: filterCfg.enabled,
      workspaceCompanyId: companyId ?? null
    };
  }
  const col = await resolveCompanyIdSourceColumn(creds, logicalName, mappingConfig);
  if (!col?.logicalName) {
    return {
      column: null,
      filter: "",
      dataType: null,
      filterValue,
      filterEnabled: filterCfg.enabled,
      workspaceCompanyId: companyId ?? null
    };
  }
  const filter = buildCompanyIdODataFilter(col.logicalName, filterValue, col.dataType);
  return {
    column: col.logicalName,
    filter,
    dataType: col.dataType || null,
    filterValue,
    filterEnabled: filterCfg.enabled,
    workspaceCompanyId: companyId ?? null
  };
}

function buildKeysetQuery(pageSize, pkAttr, afterId, extraFilter) {
  const parts = [`$top=${pageSize}`, `$orderby=${encodeURIComponent(pkAttr)} asc`];
  const filter = combineODataFilters(extraFilter, odataFilterAfterPk(pkAttr, afterId));
  if (filter) parts.unshift(`$filter=${encodeURIComponent(filter)}`);
  return parts.join("&");
}

async function previewRecords(creds, logicalName, entitySetName, options = {}) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const pageSize = Math.min(Math.max(Number(options.top) || 50, 1), 200);
  const nextLink = options.nextLink ? String(options.nextLink).trim() : "";
  const afterId = options.afterId ? String(options.afterId).trim() : "";
  const ln = String(logicalName || "").trim();
  const pkAttr = primaryKeyAttribute(ln);
  const prefer = `odata.include-annotations="*",odata.maxpagesize=${pageSize}`;
  const scope = await buildCompanyScope(creds, ln, options.companyId, options.mappingConfig);

  let json;
  let set = entitySetName ? String(entitySetName).trim() : "";

  if (nextLink) {
    json = await dvFetchAbsolute(accessToken, nextLink, prefer);
  } else {
    set = await resolveEntitySetName(creds, ln, entitySetName);
    const query = pkAttr
      ? buildKeysetQuery(pageSize, pkAttr, afterId, scope.filter)
      : scope.filter
        ? `$top=${pageSize}&$filter=${encodeURIComponent(scope.filter)}`
        : `$top=${pageSize}`;
    json = await dvFetch(environmentUrl, accessToken, `/${set}`, query, prefer);
  }

  const totalCount =
    nextLink || afterId
      ? null
      : await countRecords(creds, ln, set, { filter: scope.filter }).catch(() => null);

  const rawRows = json?.value || [];
  let customColumnMeta = [];
  if (ln) {
    try {
      customColumnMeta = await getTableColumns(creds, ln);
    } catch {
      customColumnMeta = [];
    }
  }
  const allowedCols = new Set(customColumnMeta.map((c) => c.logicalName));
  if (scope.column) allowedCols.add(scope.column);
  const rows = rawRows
    .map((r) => flattenRecord(r))
    .filter((r) => passesCompanyScope(r, scope, scope.filterValue))
    .map((r) => filterRowToCustomColumns(r, allowedCols, ln));
  const columns =
    allowedCols.size > 0 ? [...allowedCols].sort((a, b) => a.localeCompare(b)) : buildPreviewColumns(rows, ln);
  const outNext = json?.["@odata.nextLink"] || null;
  let nextCursor = null;
  if (pkAttr && rawRows.length > 0) {
    const lastRaw = rawRows[rawRows.length - 1];
    nextCursor = lastRaw[pkAttr] ?? lastRaw[`_${pkAttr}_value`] ?? null;
    if (nextCursor != null) nextCursor = String(nextCursor);
  }
  const hasNext = Boolean(outNext) || (rows.length >= pageSize && Boolean(nextCursor));

  let companyDistribution = null;
  if (
    !nextLink &&
    !afterId &&
    scope.column &&
    scope.filter &&
    (rows.length === 0 || (totalCount != null && totalCount === 0))
  ) {
    companyDistribution = await summarizeCompanyIdDistribution(creds, ln, set, scope.column).catch(
      () => null
    );
  }

  return {
    entitySetName: set,
    rows,
    columns,
    previewCount: rows.length,
    totalCount: totalCount ?? json?.["@odata.count"] ?? null,
    pageSize,
    page: Math.max(1, Number(options.page) || 1),
    nextLink: outNext,
    nextCursor,
    hasNext,
    companyScope: {
      column: scope.column,
      filter: scope.filter,
      filtered: Boolean(scope.filter),
      filterValue: scope.filterValue,
      workspaceCompanyId: scope.workspaceCompanyId,
      companyId: options.companyId ?? null
    },
    companyDistribution
  };
}

function normalizeCellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => normalizeCellValue(x)).join(", ");
  if (typeof v === "object") {
    const extracted = extractODataPrimitive(v);
    if (extracted !== v) return normalizeCellValue(extracted);
    if ("@odata.type" in v) return v.Label ?? v.value ?? v.Value ?? JSON.stringify(v);
    return JSON.stringify(v);
  }
  return v;
}

function shouldSkipAttributeKey(k) {
  if (!k || k.startsWith("@")) return true;
  if (k.includes("@odata")) return true;
  if (k.includes("@Microsoft.Dynamics.CRM")) return true;
  if (/lookuplogicalname/i.test(k)) return true;
  return false;
}

function flattenRecord(row) {
  const raw = row || {};
  const formatted = {};
  const plain = {};

  for (const [k, v] of Object.entries(raw)) {
    if (shouldSkipAttributeKey(k)) continue;
    if (k.endsWith(FORMATTED_SUFFIX)) {
      formatted[k.slice(0, -FORMATTED_SUFFIX.length)] = normalizeCellValue(v);
    } else {
      plain[k] = v;
    }
  }

  const out = {};
  const keys = new Set([...Object.keys(formatted), ...Object.keys(plain)]);
  for (const key of keys) {
    const plainNorm = normalizeCellValue(plain[key]);
    const fmtRaw = formatted[key];
    const hasFmt = fmtRaw != null && fmtRaw !== "";

    if (typeof plainNorm === "number" && Number.isFinite(plainNorm)) {
      out[key] = plainNorm;
    } else if (hasFmt) {
      const fmtNorm = normalizeCellValue(fmtRaw);
      const parsed = parseNumericValue(fmtNorm);
      out[key] = parsed != null ? parsed : fmtNorm;
    } else {
      out[key] = plainNorm;
    }
  }
  return out;
}

function buildPreviewColumns(rows, entityLogicalName) {
  const set = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row || {})) {
      if (shouldSkipAttributeKey(k)) continue;
      if (!isCustomDataverseColumn(k, entityLogicalName)) continue;
      set.add(k);
    }
  }
  const cols = [...set];
  const score = (c) => {
    const lc = c.toLowerCase();
    if (lc.startsWith("_")) return 8;
    if (/^cr\d+_/.test(lc)) return 0;
    if (lc.endsWith("id") && !lc.includes("_value")) return 1;
    if (lc.includes("name") || lc.includes("code") || lc.includes("office")) return 2;
    if (lc.includes("balance") || lc.includes("amount") || lc.includes("rent")) return 3;
    if (lc.includes("date")) return 4;
    return 6;
  };
  return cols.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

/**
 * Async generator of all records with paging.
 */
async function* iterateRecords(creds, logicalName, entitySetName, pageSize = 500, options = {}) {
  const { accessToken, environmentUrl } = await getDataverseAccessToken(creds);
  const ln = String(logicalName || "").trim();
  const set = await resolveEntitySetName(creds, ln, entitySetName);
  const pkAttr = primaryKeyAttribute(ln);
  const size = Math.min(Math.max(Number(pageSize) || 500, 1), 5000);
  const prefer = `odata.include-annotations="*",odata.maxpagesize=${size}`;
  const scope = await buildCompanyScope(creds, ln, options.companyId, options.mappingConfig);
  let afterId = "";
  let url = null;

  for (;;) {
    if (url) {
      const json = await dvFetchAbsolute(accessToken, url, prefer);
      const batch = json?.value || [];
      for (const row of batch) {
        const record = flattenRecord(row);
        if (!passesCompanyScope(record, scope, scope.filterValue)) continue;
        yield { record, sourceId: row[pkAttr] || row.activityid || null };
      }
      url = json?.["@odata.nextLink"] || null;
      if (url) continue;
      if (batch.length < size || !pkAttr) break;
      const last = batch[batch.length - 1];
      afterId = String(last[pkAttr] || "");
      if (!afterId) break;
      url = null;
    }

    const query = pkAttr
      ? buildKeysetQuery(size, pkAttr, afterId, scope.filter)
      : scope.filter
        ? `$top=${size}&$filter=${encodeURIComponent(scope.filter)}`
        : `$top=${size}`;
    const json = await dvFetch(environmentUrl, accessToken, `/${set}`, query, prefer);
    const batch = json?.value || [];
    for (const row of batch) {
      const record = flattenRecord(row);
      if (!passesCompanyScope(record, scope, scope.filterValue)) continue;
      yield { record, sourceId: row[pkAttr] || row.activityid || null };
    }
    url = json?.["@odata.nextLink"] || null;
    if (url) continue;
    if (batch.length < size || !pkAttr) break;
    const last = batch[batch.length - 1];
    afterId = String(last[pkAttr] || "");
    if (!afterId) break;
  }
}

module.exports = {
  testConnection,
  listTables,
  getTableColumns,
  countRecords,
  previewRecords,
  iterateRecords,
  resolveEntitySetName,
  resolveCompanyIdSourceColumn,
  buildCompanyScope,
  buildCompanyIdODataFilter,
  recordMatchesCompanyId,
  passesCompanyScope,
  summarizeCompanyIdDistribution,
  parseSourceCompanyFilterConfig,
  resolveSourceCompanyFilterValue,
  getDataverseAccessToken,
  flattenRecord,
  buildPreviewColumns,
  primaryKeyAttribute,
  isCustomDataverseColumn,
  filterRowToCustomColumns
};
