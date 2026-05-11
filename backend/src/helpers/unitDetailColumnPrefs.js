/** Unit detail report: column keys stored in CompanyCollectionSettings.UnitDetailColumnPrefs (per CompanyId). */
const ALL_KEYS = [
  "property",
  "unit",
  "name",
  "tenantCode",
  "balance",
  "rent",
  "monthsDelinquent",
  "legalStatus",
  "nextFollowUp",
  "lastPayment",
  "phone",
  "email",
  "actions"
];

const KEY_SET = new Set(ALL_KEYS);

function normalizeUnitDetailColumnPrefs(input) {
  const raw = input && typeof input === "object" ? input : {};
  const hidden = new Set();
  if (Array.isArray(raw.hidden)) {
    for (const h of raw.hidden) {
      const k = typeof h === "string" ? h.trim() : "";
      if (KEY_SET.has(k) && k !== "actions") hidden.add(k);
    }
  }
  let order = Array.isArray(raw.columnOrder)
    ? raw.columnOrder.map((x) => (typeof x === "string" ? x.trim() : "")).filter((k) => KEY_SET.has(k))
    : [];
  const seen = new Set();
  order = order.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const k of ALL_KEYS) {
    if (!seen.has(k)) order.push(k);
  }
  order = order.filter((k) => k !== "actions");
  order.push("actions");
  return { columnOrder: order, hidden: [...hidden] };
}

function parsePrefsJson(raw) {
  if (raw == null || raw === "") return null;
  try {
    const o = JSON.parse(String(raw));
    return typeof o === "object" && o !== null ? o : null;
  } catch {
    return null;
  }
}

module.exports = {
  UNIT_DETAIL_COLUMN_ALL_KEYS: ALL_KEYS,
  normalizeUnitDetailColumnPrefs,
  parsePrefsJson
};
