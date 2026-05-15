/**
 * ERP deep-link id: prefer Hmyperson (Yardi person id), fall back to TenantCode.
 * @param {Record<string, unknown> | null | undefined} unit
 */
/** @param {Record<string, unknown> | null | undefined} unit */
export function hmypersonFromUnit(unit) {
  if (!unit || typeof unit !== "object") return "";
  for (const k of Object.keys(unit)) {
    if (k.toLowerCase().replace(/[\s_]/g, "") === "hmyperson") {
      const v = unit[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return unit.hmyperson != null ? String(unit.hmyperson).trim() : "";
}

/** @param {Record<string, unknown> | null | undefined} unit */
export function tenantCodeFromUnit(unit) {
  if (!unit || typeof unit !== "object") return "";
  for (const k of Object.keys(unit)) {
    if (k.toLowerCase() === "tenantcode") {
      const v = unit[k];
      return v == null ? "" : String(v).trim();
    }
  }
  return unit.tenantCode != null ? String(unit.tenantCode).trim() : "";
}

export function erpLinkIdFromUnit(unit) {
  const hp = hmypersonFromUnit(unit);
  if (hp) return hp;
  return tenantCodeFromUnit(unit);
}

/**
 * @param {string | null | undefined} staticPart
 * @param {string | null | undefined} linkId
 */
export function buildErpDeepLink(staticPart, linkId) {
  if (!staticPart || typeof staticPart !== "string") return null;
  const base = staticPart.trim();
  if (!base) return null;
  if (linkId === undefined || linkId === null) return null;
  const code = String(linkId).trim();
  if (!code) return null;
  return `${base}${code}`;
}
