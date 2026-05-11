/**
 * Active company id for this deployment.
 * Today: VITE_DEFAULT_COMPANY_ID in .env — keep in sync with backend DEFAULT_COMPANY_ID.
 * Later: replace with session / user / route.
 */
export function getActiveCompanyId() {
  const raw = import.meta.env.VITE_DEFAULT_COMPANY_ID;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new Error("VITE_DEFAULT_COMPANY_ID is not set in environment");
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
