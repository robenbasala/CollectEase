import { getActiveCompanyId } from "../config/company.js";

function resolveApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw != null && String(raw).trim() !== "") {
    return String(raw).replace(/\/+$/, "");
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return `${window.location.origin}/api`;
  }
  return "http://localhost:5000/api";
}

const API_BASE = resolveApiBase();

function buildUrl(path, query) {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item === undefined || item === null || item === "") continue;
          url.searchParams.append(k, String(item));
        }
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

async function request(method, path, { query, body, omitCompanyId } = {}) {
  const mergedQuery =
    omitCompanyId === true ? { ...query } : { ...query, companyId: getActiveCompanyId() };
  const url = buildUrl(path, mergedQuery);
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("<")) {
      throw new Error(
        `API returned HTML (${res.status}) at ${url.split("?")[0]}. ` +
          `In dev, use Vite proxy: set VITE_API_BASE_URL empty or to ${typeof window !== "undefined" ? `${window.location.origin}/api` : "/api"} and restart Vite. ` +
          `Otherwise confirm the backend is running and includes route /api/admin/unit-detail-columns.`
      );
    }
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON from API (${res.status}): ${e.message}`);
    }
  }
  if (!res.ok) {
    const msg = data?.error || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return data;
}

export const api = {
  listCompanies: () => request("GET", "/companies", { omitCompanyId: true }),

  getDashboardRegions: () => request("GET", "/dashboard/regions"),
  getDashboardPortfolios: (region) =>
    request("GET", "/dashboard/portfolios", { query: { region } }),
  getDashboardProperties: (region, portfolio) =>
    request("GET", "/dashboard/properties", { query: { region, portfolio } }),
  getDashboardSummary: (region) =>
    request("GET", "/dashboard/summary", { query: { region } }),
  getDashboardUnits: (params) => {
    const props =
      params.properties && params.properties.length > 0 ? params.properties : undefined;
    return request("GET", "/dashboard/units", {
      query: {
        property: props ? undefined : params.property,
        properties: props,
        name: params.name,
        unit: params.unit,
        legalStatus: params.legalStatus,
        collection: params.collection,
        alert: params.alert || undefined,
        delinq: params.delinq || undefined,
        occupied:
          params.occupied === true || params.occupied === "1" ? "1" : undefined
      }
    });
  },

  getAdminRegions: () => request("GET", "/admin/regions"),
  postAdminRegion: (name) => request("POST", "/admin/regions", { body: { name } }),
  putAdminRegion: (id, name) => request("PUT", `/admin/regions/${id}`, { body: { name } }),
  deleteAdminRegion: (id) => request("DELETE", `/admin/regions/${id}`),

  getAdminPortfolios: (regionId) =>
    request("GET", "/admin/portfolios", { query: { regionId } }),
  postAdminPortfolio: (regionId, name) =>
    request("POST", "/admin/portfolios", { body: { regionId, name } }),
  putAdminPortfolio: (id, body) => request("PUT", `/admin/portfolios/${id}`, { body }),
  deleteAdminPortfolio: (id) => request("DELETE", `/admin/portfolios/${id}`),

  getAdminProperties: (portfolioId) =>
    request("GET", "/admin/properties", { query: { portfolioId } }),
  postAdminProperty: (portfolioId, name, listName) =>
    request("POST", "/admin/properties", { body: { portfolioId, name, listName } }),
  putAdminProperty: (id, body) => request("PUT", `/admin/properties/${id}`, { body }),
  deleteAdminProperty: (id) => request("DELETE", `/admin/properties/${id}`),

  getAdminCompanySettings: () => request("GET", "/admin/company-settings"),
  putAdminCompanySettings: (body) => request("PUT", "/admin/company-settings", { body }),
  getAdminUnitDetailColumnPrefs: () => request("GET", "/admin/unit-detail-columns"),
  putAdminUnitDetailColumnPrefs: (body) => request("PUT", "/admin/unit-detail-columns", { body }),
  getAdminPropertyListNames: () => request("GET", "/admin/property-list-names")
};
