import { getApiCompanyId } from "../auth/session.js";

/**
 * Company id for API URLs and deep links. Uses signed-in context when available, else VITE_DEFAULT_COMPANY_ID.
 */
export function getActiveCompanyId() {
  const fromAuth = getApiCompanyId();
  if (fromAuth != null) {
    const n = Number(fromAuth);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const raw = import.meta.env.VITE_DEFAULT_COMPANY_ID;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new Error("Sign in first, or set VITE_DEFAULT_COMPANY_ID for legacy fallback.");
  }
  const id = Number(String(raw).trim());
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("VITE_DEFAULT_COMPANY_ID must be a positive integer");
  }
  return id;
}

/** Optional label for the navbar (e.g. Montium). */
export function getCompanyDisplayName() {
  return import.meta.env.VITE_COMPANY_NAME || "";
}
