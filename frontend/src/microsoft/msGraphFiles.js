import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { getMsalInstance, isMicrosoftMailConfigured } from "./msGraphMail.js";

/** OneDrive / SharePoint library browse (Graph). Add Files.Read.All + Sites.Read.All in Azure App Registration. */
const FILES_SCOPES = ["Files.Read.All", "Sites.Read.All", "User.Read"];

export function isGraphFilesBrowseConfigured() {
  return isMicrosoftMailConfigured();
}

async function graphReadJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let j = null;
  if (text) {
    try {
      j = JSON.parse(text);
    } catch {
      /* ignore */
    }
  }
  if (!res.ok) {
    const msg = j?.error?.message || text || res.statusText || `Graph ${res.status}`;
    throw new Error(msg);
  }
  return j;
}

export async function acquireGraphFilesAccessToken() {
  const app = await getMsalInstance();
  if (!app) throw new Error("Microsoft is not configured (set VITE_MS_CLIENT_ID).");
  const account = app.getActiveAccount() || app.getAllAccounts()[0];
  if (!account) throw new Error("Sign in with Microsoft first (use the toolbar Microsoft sign-in).");

  const silentRequest = { scopes: FILES_SCOPES, account };
  try {
    const result = await app.acquireTokenSilent(silentRequest);
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const result = await app.acquireTokenPopup({ scopes: FILES_SCOPES, account });
      return result.accessToken;
    }
    throw e;
  }
}

/**
 * @param {string} token
 * @returns {Promise<{ value: Array<{ id: string; name: string; folder?: object; file?: object; parentReference?: { driveId?: string } }> }>}
 */
export async function listMeDriveRootChildren(token) {
  return graphReadJson("https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200", token);
}

/**
 * @param {string} token
 * @param {string} driveId
 * @param {string} itemId
 */
export async function listDriveItemChildren(token, driveId, itemId) {
  const encD = encodeURIComponent(driveId);
  const encI = encodeURIComponent(itemId);
  return graphReadJson(`https://graph.microsoft.com/v1.0/drives/${encD}/items/${encI}/children?$top=200`, token);
}

/**
 * @param {string} token
 * @param {string} driveId
 * @param {string} itemId
 * @returns {Promise<string|null>}
 */
export async function getExcelDownloadUrl(token, driveId, itemId) {
  const encD = encodeURIComponent(driveId);
  const encI = encodeURIComponent(itemId);
  const j = await graphReadJson(
    `https://graph.microsoft.com/v1.0/drives/${encD}/items/${encI}?select=id,name,file,@microsoft.graph.downloadUrl`,
    token
  );
  const u = j["@microsoft.graph.downloadUrl"];
  return typeof u === "string" && u.startsWith("http") ? u : null;
}

export async function listDriveRootChildren(token, driveId) {
  return graphReadJson(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root/children?$top=200`, token);
}

/**
 * Microsoft Graph site key: `{hostname}:{server-relative-path}`
 * Example: `contoso.sharepoint.com:/sites/Finance`
 * Accepts a full browser URL and normalizes it.
 * @param {string} input
 * @returns {string}
 */
export function toGraphSiteIdentifier(input) {
  let s = String(input || "").trim();
  if (!s) throw new Error("Enter your SharePoint site address.");

  s = s.replace(/\/+$/, "");

  if (/^https?:\/\//i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      throw new Error("That does not look like a valid URL.");
    }
    const host = u.hostname.toLowerCase();
    let path = u.pathname || "";
    path = path.replace(/\/+$/, "") || "";
    if (!path || path === "/") {
      throw new Error("Open the site in the browser and paste the full address including /sites/… (not only the home page).");
    }
    if (!path.startsWith("/")) path = `/${path}`;
    return `${host}:${path}`;
  }

  const colonIdx = s.indexOf(":");
  if (colonIdx > 0) {
    const hostPart = s.slice(0, colonIdx).toLowerCase().trim();
    let pathPart = s.slice(colonIdx + 1).trim();
    if (!pathPart.startsWith("/")) pathPart = `/${pathPart.replace(/^\/+/, "")}`;
    if (pathPart === "/" || pathPart === "") {
      throw new Error("After the colon, include the site path (e.g. :/sites/YourSite).");
    }
    return `${hostPart}:${pathPart}`;
  }

  const slash = s.indexOf("/");
  if (slash > 0 && /\./.test(s.slice(0, slash))) {
    const hostPart = s.slice(0, slash).toLowerCase();
    let pathPart = s.slice(slash).replace(/\/+$/, "") || "";
    if (!pathPart || pathPart === "/") {
      throw new Error("Include the path, e.g. tenant.sharepoint.com/sites/YourSite");
    }
    if (!pathPart.startsWith("/")) pathPart = `/${pathPart}`;
    return `${hostPart}:${pathPart}`;
  }

  throw new Error(
    "Paste the site URL from the address bar (https://…sharepoint.com/sites/…), or tenant.sharepoint.com:/sites/SiteName"
  );
}

/**
 * Resolves site and returns the default document library drive id (Graph).
 * @param {string} token
 * @param {string} sitePath full SharePoint URL or `hostname:/sites/...`
 * @returns {Promise<{ driveId: string; label: string }>}
 */
export async function resolveSharePointSiteDrive(token, sitePath) {
  const fq = toGraphSiteIdentifier(sitePath);
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(fq)}`;
  let site;
  try {
    site = await graphReadJson(siteUrl, token);
  } catch (e) {
    const m = String(e?.message || "");
    if (/invalid hostname|tenancy/i.test(m)) {
      throw new Error(
        `${m} Sign in with a Microsoft work account from the same organization as this SharePoint site, and confirm the site URL is correct.`
      );
    }
    throw e;
  }
  const drives = await graphReadJson(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site.id)}/drives`, token);
  const list = drives?.value || [];
  const doc =
    list.find((d) => /document/i.test(String(d.name || ""))) ||
    list.find((d) => String(d.driveType || "").toLowerCase() === "documentlibrary") ||
    list[0];
  if (!doc?.id) throw new Error("No document library found for this site.");
  return { driveId: doc.id, label: fq };
}

export function isExcelGraphItem(item) {
  if (!item?.file) return false;
  const n = String(item.name || "").toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xlsm") || n.endsWith(".xls");
}
