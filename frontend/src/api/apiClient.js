import { getFirebaseIdToken, getApiCompanyId } from "../auth/session.js";

/**
 * In Vite dev, calling http://localhost:5000 from the browser often fails (backend down,
 * firewall, or 127.0.0.1 vs localhost mismatch). Prefer same-origin /api so vite.config.js
 * proxies to the real API.
 */
function shouldUseViteProxyInDev(apiUrl) {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const t = String(apiUrl ?? "").trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    const h = u.hostname.toLowerCase();
    if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]") return false;
    const p = u.port || (u.protocol === "https:" ? "443" : "80");
    return p === "5000";
  } catch {
    return false;
  }
}

function resolveApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  const trimmed = raw != null ? String(raw).trim() : "";
  if (shouldUseViteProxyInDev(trimmed)) {
    return `${window.location.origin}/api`.replace(/\/+$/, "");
  }
  if (trimmed !== "") {
    return trimmed.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return `${window.location.origin}/api`.replace(/\/+$/, "");
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
  const mergedQuery = { ...(query || {}) };
  if (omitCompanyId !== true) {
    const cid = getApiCompanyId();
    if (cid != null && Number.isInteger(Number(cid)) && Number(cid) > 0) {
      mergedQuery.companyId = Number(cid);
    }
  }
  const url = buildUrl(path, mergedQuery);
  const opts = { method, headers: {} };
  const token = await getFirebaseIdToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    const net = e?.message || String(e);
    const baseHint =
      import.meta.env.DEV
        ? " In dev, run the API from collection-tracker/backend (npm run dev). Requests use the Vite /api proxy when VITE_API_BASE_URL points at localhost:5000."
        : " Confirm the deployed API URL and that the service is reachable.";
    if (net === "Failed to fetch" || /networkerror|load failed/i.test(net)) {
      throw new Error(`Cannot reach the API (${url.split("?")[0]}).${baseHint}`);
    }
    throw e;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("<")) {
      throw new Error(
        `API returned HTML (${res.status}) at ${url.split("?")[0]}. ` +
          `Often the wrong process is on that port, or the backend was not restarted after a code update. ` +
          `Restart the backend from collection-tracker/backend (npm run dev). ` +
          `In dev with Vite, you can set VITE_API_BASE_URL empty or to ${typeof window !== "undefined" ? `${window.location.origin}/api` : "/api"} and restart Vite so /api is proxied.`
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
    const err = new Error(msg);
    err.status = res.status;
    if (data?.code) err.code = data.code;
    if (data?.details != null) err.details = data.details;
    throw err;
  }
  return data;
}

export const api = {
  getAuthMe: () => request("GET", "/auth/me"),
  postAuthInvite: (body) => request("POST", "/auth/invite", { body }),
  getAuthUsers: (companyId) =>
    request("GET", "/auth/users", { query: companyId != null ? { companyId } : {} }),
  getAuthPropertyOptions: (companyId) =>
    request("GET", "/auth/property-options", { query: companyId != null ? { companyId } : {} }),
  patchAuthUser: (uid, body) => request("PATCH", `/auth/users/${encodeURIComponent(uid)}`, { body }),

  listCompanies: () => request("GET", "/companies", { omitCompanyId: true }),
  postCompany: (name) => request("POST", "/companies", { body: { name } }),

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

  patchDashboardUnitRow: (body) => request("PATCH", "/dashboard/unit-row", { body }),
  getDashboardUnitNotes: (query) => request("GET", "/dashboard/unit-notes", { query }),
  postDashboardUnitNote: (body) => request("POST", "/dashboard/unit-notes", { body }),
  patchDashboardUnitNote: (id, body) => request("PATCH", `/dashboard/unit-notes/${id}`, { body }),
  deleteDashboardUnitNote: (id) => request("DELETE", `/dashboard/unit-notes/${id}`),

  getDashboardUnitLegalHistory: (query) => request("GET", "/dashboard/unit-legal-history", { query }),

  /* Legal cases (multi-case workflow per tenant) */
  getDashboardLegalCases: (query) =>
    request("GET", "/dashboard/unit-legal-cases", { query }),
  postDashboardLegalCase: (body) =>
    request("POST", "/dashboard/unit-legal-cases", { body }),
  patchDashboardLegalCase: (id, body) =>
    request("PATCH", `/dashboard/unit-legal-cases/${id}`, { body }),
  deleteDashboardLegalCase: (id) =>
    request("DELETE", `/dashboard/unit-legal-cases/${id}`),
  getDashboardLegalCaseStatuses: (id) =>
    request("GET", `/dashboard/unit-legal-cases/${id}/statuses`),
  postDashboardLegalCaseStatus: (id, body) =>
    request("POST", `/dashboard/unit-legal-cases/${id}/statuses`, { body }),
  deleteDashboardLegalCaseStatus: (statusId) =>
    request("DELETE", `/dashboard/unit-legal-case-statuses/${statusId}`),
  getDashboardPropertyLegalStatusOptions: (property) =>
    request("GET", "/dashboard/property-legal-status-options", { query: { property } }),

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
  getAdminPropertyListNames: () => request("GET", "/admin/property-list-names"),

  getAdminReminderEmailLog: () => request("GET", "/admin/reminder-email-log"),
  postAdminReminderEmailLog: (body) => request("POST", "/admin/reminder-email-log", { body }),

  /* Admin: legal-status preset lists (properties select one by ListName) */
  getAdminLegalStatusPresetLists: () => request("GET", "/admin/legal-status-preset-lists"),
  postAdminLegalStatusPresetList: (name) =>
    request("POST", "/admin/legal-status-preset-lists", { body: { name } }),
  putAdminLegalStatusPresetList: (listId, body) =>
    request("PUT", `/admin/legal-status-preset-lists/${listId}`, { body }),
  deleteAdminLegalStatusPresetList: (listId) =>
    request("DELETE", `/admin/legal-status-preset-lists/${listId}`),
  getAdminLegalStatusPresetOptions: (listId) =>
    request("GET", `/admin/legal-status-preset-lists/${listId}/options`),
  postAdminLegalStatusPresetOption: (listId, body) =>
    request("POST", `/admin/legal-status-preset-lists/${listId}/options`, { body }),
  putAdminLegalStatusPresetOption: (listId, id, body) =>
    request("PUT", `/admin/legal-status-preset-lists/${listId}/options/${id}`, { body }),
  deleteAdminLegalStatusPresetOption: (listId, id) =>
    request("DELETE", `/admin/legal-status-preset-lists/${listId}/options/${id}`)
};
